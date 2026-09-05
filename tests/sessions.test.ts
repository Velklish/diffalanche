import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  DomainError,
  listSessions,
  parseBaseArgument,
  resolveSessionName,
  setBase,
  useSession,
} from "../src/core/domain/index.ts";
import {
  commentsPath,
  currentPath,
  dataDirOf,
  ensureDataDir,
  readCurrent,
  readReview,
  reviewPath,
  StorageError,
  updateComments,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import { comment } from "./helpers/session.ts";

let root: string;
let dataDir: string;

/** What `head` mode resolves to in a repository, as `diff.json` records it. */
const head = { mode: "head", ref: "HEAD", sha: "0".repeat(40) } as const;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-sessions-"));
  dataDir = dataDirOf(root);
  await ensureDataDir(dataDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseBaseArgument", () => {
  it("reads the four forms of docs/SPEC.md section 8", () => {
    expect(parseBaseArgument("head")).toEqual({ mode: "head" });
    expect(parseBaseArgument("branch")).toEqual({ mode: "branch" });
    expect(parseBaseArgument("branch:origin/develop")).toEqual({
      mode: "branch",
      branch: "origin/develop",
    });
    expect(parseBaseArgument("v1.2.0")).toEqual({ mode: "ref", ref: "v1.2.0" });
    expect(parseBaseArgument("HEAD~3")).toEqual({ mode: "ref", ref: "HEAD~3" });
  });

  it("refuses an empty base and a branch: naming no branch", () => {
    expect(() => parseBaseArgument("")).toThrow(DomainError);
    expect(() => parseBaseArgument("branch:")).toThrow(/names no branch/);
  });
});

describe("createSession", () => {
  it("writes the session and makes it current", async () => {
    const review = await createSession(dataDir, "ls-240372", { mode: "head" }, "Cargo flags");

    expect(existsSync(reviewPath(dataDir, "ls-240372"))).toBe(true);
    expect(existsSync(commentsPath(dataDir, "ls-240372"))).toBe(true);
    expect(readFileSync(currentPath(dataDir), "utf8")).toBe("ls-240372\n");
    expect(review).toMatchObject({
      version: 1,
      name: "ls-240372",
      title: "Cargo flags",
      base: { mode: "head" },
    });
    expect(review.createdAt).toBe(review.updatedAt);
  });

  it("leaves the title out when there is none", async () => {
    expect((await createSession(dataDir, "one", { mode: "branch" })).title).toBeNull();
  });

  it("switches current to the newest session", async () => {
    await createSession(dataDir, "first", { mode: "head" });
    await createSession(dataDir, "second", { mode: "head" });
    expect(await readCurrent(dataDir)).toBe("second");
  });

  it("refuses a name outside the character set", async () => {
    for (const name of ["LS-240372", "with space", "with/slash", "..", ""]) {
      const error = await createSession(dataDir, name, { mode: "head" }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("invalid-name");
    }
  });

  it("gives the loser of two creates at once the same refusal", async () => {
    const [first, second] = await Promise.allSettled([
      createSession(dataDir, "same", { mode: "head" }),
      createSession(dataDir, "same", { mode: "head" }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((one) => one.status === "fulfilled")).toHaveLength(1);
    const refused = outcomes.find((one) => one.status === "rejected");
    expect(refused?.status === "rejected" ? refused.reason : null).toBeInstanceOf(DomainError);
    expect((refused?.status === "rejected" ? refused.reason : null).code).toBe("session-exists");
  });

  it("refuses a name whose review.json is broken, and keeps the comments", async () => {
    await createSession(dataDir, "one", { mode: "head" });
    await updateComments(dataDir, "one", (comments) => {
      comments.push(comment("c_aaaaaa"));
    });
    writeFileSync(reviewPath(dataDir, "one"), '{ "version": 2 }\n');

    const error = await createSession(dataDir, "one", { mode: "head" }).catch(
      (caught: unknown) => caught,
    );
    expect((error as DomainError).code).toBe("session-exists");
    // A session is never removed by the tool; its comments have to still be there.
    expect(readFileSync(commentsPath(dataDir, "one"), "utf8")).toContain("c_aaaaaa");
    expect(readFileSync(reviewPath(dataDir, "one"), "utf8")).toBe('{ "version": 2 }\n');
  });

  it("surfaces a broken review.json instead of calling the session missing", async () => {
    await createSession(dataDir, "one", { mode: "head" });
    writeFileSync(reviewPath(dataDir, "one"), '{ "version": 1, "name": 7 }\n');

    const error = await useSession(dataDir, "one").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).field).toBe("name");
  });

  it("refuses a name that is already a session", async () => {
    await createSession(dataDir, "one", { mode: "head" }, "the first");
    const error = await createSession(dataDir, "one", { mode: "head" }).catch(
      (caught: unknown) => caught,
    );
    expect((error as DomainError).code).toBe("session-exists");
    // The refusal changed nothing: the title of the session that was there stands.
    expect((await readReview(dataDir, "one")).title).toBe("the first");
  });
});

describe("useSession", () => {
  it("switches current back and forth", async () => {
    await createSession(dataDir, "first", { mode: "head" });
    await createSession(dataDir, "second", { mode: "head" });

    await useSession(dataDir, "first");
    expect(await readCurrent(dataDir)).toBe("first");
    await useSession(dataDir, "second");
    expect(await readCurrent(dataDir)).toBe("second");
  });

  it("refuses a session that is not there", async () => {
    const error = await useSession(dataDir, "missing").catch((caught: unknown) => caught);
    expect((error as DomainError).code).toBe("no-such-session");
  });
});

describe("setBase", () => {
  it("writes the new base and bumps updatedAt", async () => {
    const created = await createSession(dataDir, "one", { mode: "head" });
    await sleep(2);

    const updated = await setBase(dataDir, "one", { mode: "branch", branch: "origin/develop" });
    expect(updated.base).toEqual({ mode: "branch", branch: "origin/develop" });
    expect(updated.updatedAt > created.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(await readReview(dataDir, "one")).toEqual(updated);
  });

  it("refuses a session that is not there", async () => {
    await expect(setBase(dataDir, "missing", { mode: "head" })).rejects.toThrow(DomainError);
  });
});

describe("listSessions", () => {
  it("counts comments and repositories, most recently updated first", async () => {
    await createSession(dataDir, "older", { mode: "head" });
    await sleep(2);
    await createSession(dataDir, "newer", { mode: "ref", ref: "v1.0.0" }, "a title");

    await updateComments(dataDir, "newer", (comments) => {
      comments.push(comment("c_aaaaaa"));
      comments.push(comment("c_bbbbbb", { status: "resolved", resolvedBy: "kim.p" }));
      comments.push(comment("c_cccccc"));
    });
    await writeDiffCache(dataDir, "newer", {
      version: 1,
      root,
      repositories: [
        { path: "repos/a", branch: "main", base: head, files: [], warnings: [] },
        { path: "repos/b", branch: "main", base: head, files: [], warnings: [] },
      ],
      totals: { repositories: 2, files: 0, lines: 0 },
      warnings: [],
    });

    const { sessions, warnings } = await listSessions(dataDir);
    expect(warnings).toEqual([]);
    expect(sessions.map((one) => one.name)).toEqual(["newer", "older"]);
    expect(sessions[0]).toMatchObject({
      name: "newer",
      title: "a title",
      base: { mode: "ref", ref: "v1.0.0" },
      current: true,
      open: 2,
      resolved: 1,
      repositories: 2,
    });
    // Nothing has been scanned in the other session, so there is no count to give.
    expect(sessions[1]).toMatchObject({ name: "older", current: false, repositories: null });
  });

  it("is empty on a data directory with no sessions", async () => {
    expect(await listSessions(dataDir)).toEqual({ sessions: [], warnings: [] });
  });
});

describe("resolveSessionName", () => {
  it("takes the named session, else the current one", async () => {
    await createSession(dataDir, "first", { mode: "head" });
    await createSession(dataDir, "second", { mode: "head" });

    expect(await resolveSessionName(dataDir)).toBe("second");
    expect(await resolveSessionName(dataDir, "first")).toBe("first");
  });

  it("refuses when nothing says which session to use", async () => {
    const error = await resolveSessionName(dataDir).catch((caught: unknown) => caught);
    expect((error as DomainError).code).toBe("no-current-session");
  });
});
