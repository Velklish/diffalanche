import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commentsPath,
  currentPath,
  dataDirOf,
  ensureDataDir,
  listSessionNames,
  readComments,
  readCurrent,
  readDiffCache,
  readReview,
  reviewPath,
  StorageError,
  sessionDir,
  updateComments,
  withLock,
  writeCurrent,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import { comment, makeSession, review } from "./helpers/session.ts";

let root: string;
let dataDir: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-storage-"));
  dataDir = dataDirOf(root);
  await ensureDataDir(dataDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A lock left behind by a writer that is gone: its own deadline is in the past. */
function staleLock(dir: string, token = "dead"): void {
  mkdirSync(join(dir, ".lock"), { recursive: true });
  writeFileSync(
    join(dir, ".lock", "info.json"),
    JSON.stringify({
      token,
      pid: 1,
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );
}

/** A lock a writer still holds. */
function liveLock(dir: string): void {
  mkdirSync(join(dir, ".lock"), { recursive: true });
  writeFileSync(
    join(dir, ".lock", "info.json"),
    JSON.stringify({
      token: "other",
      pid: 1,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
}

describe("data directory", () => {
  it("sits in the root and holds reviews/", () => {
    expect(dataDir).toBe(join(root, ".diffalanche"));
    expect(readdirSync(join(root, ".diffalanche"))).toEqual(["reviews"]);
  });

  it("writes JSON with version 1 and two-space indentation", async () => {
    await makeSession(dataDir, "one", [comment("c_aaaaaa")]);
    const text = readFileSync(reviewPath(dataDir, "one"), "utf8");
    expect(text.startsWith('{\n  "version": 1,\n')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(readFileSync(commentsPath(dataDir, "one"), "utf8")).toContain('\n  "comments": [\n');
  });

  it("points current at one session with a single newline-terminated line", async () => {
    await writeCurrent(dataDir, "one");
    expect(readFileSync(currentPath(dataDir), "utf8")).toBe("one\n");
    expect(await readCurrent(dataDir)).toBe("one");
  });

  it("has no current session before one is written", async () => {
    expect(await readCurrent(dataDir)).toBeNull();
  });

  it("refuses a session name that would leave the data directory", async () => {
    for (const name of ["../../repos/group/svc", "..", ".", "", "a/b", "a\\b"]) {
      expect(() => sessionDir(dataDir, name)).toThrow(StorageError);
      await expect(writeCurrent(dataDir, name)).rejects.toThrow(/single path segment/);
    }
    // The traversal target was never written: the tool writes nowhere but the data directory.
    expect(existsSync(join(root, "..", "repos"))).toBe(false);
  });
});

describe("session listing", () => {
  it("lists session directories sorted and warns about the rest", async () => {
    await makeSession(dataDir, "beta");
    await makeSession(dataDir, "alpha");
    mkdirSync(join(dataDir, "reviews", "not-a-session"));

    const listing = await listSessionNames(dataDir);
    expect(listing.names).toEqual(["alpha", "beta"]);
    expect(listing.warnings).toHaveLength(1);
    expect(listing.warnings[0]).toContain("not-a-session");
    expect(listing.warnings[0]).toContain("no review.json");
  });

  it("is empty on a data directory with no reviews/ at all", async () => {
    expect(await listSessionNames(join(root, "nowhere"))).toEqual({ names: [], warnings: [] });
  });
});

describe("reading", () => {
  it("names the file and the field of a broken value", async () => {
    await makeSession(dataDir, "one");
    writeFileSync(
      commentsPath(dataDir, "one"),
      JSON.stringify({ version: 1, comments: [{ ...comment("c_aaaaaa"), severity: "urgent" }] }),
    );

    const error = await readComments(dataDir, "one").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).file).toBe(commentsPath(dataDir, "one"));
    expect((error as StorageError).field).toBe("comments[0].severity");
    expect((error as StorageError).message).toContain("critical, warning, nit, question");
  });

  it("refuses a file of an unknown schema version", async () => {
    await makeSession(dataDir, "one");
    writeFileSync(reviewPath(dataDir, "one"), JSON.stringify({ ...review("one"), version: 2 }));
    await expect(readReview(dataDir, "one")).rejects.toThrow(/version: expected 1, got 2/);
  });

  it("refuses a review session that does not exist", async () => {
    await expect(readReview(dataDir, "missing")).rejects.toThrow(/no such review session/);
  });

  it("reads a hand-edited comments.json back unchanged, extra reply included", async () => {
    await makeSession(dataDir, "one", [comment("c_aaaaaa")]);
    const file = JSON.parse(readFileSync(commentsPath(dataDir, "one"), "utf8"));
    file.comments[0].replies.push({
      id: "r_1",
      author: "kim.p",
      role: "human",
      body: "written by hand",
      createdAt: "2026-09-02T10:00:00Z",
    });
    writeFileSync(commentsPath(dataDir, "one"), `${JSON.stringify(file, null, 2)}\n`);

    const comments = await readComments(dataDir, "one");
    expect(comments).toEqual(file.comments);
  });

  it("has no diff cache until a scan writes one", async () => {
    await makeSession(dataDir, "one");
    expect(await readDiffCache(dataDir, "one")).toBeNull();

    const cache = {
      version: 1,
      root,
      repositories: [],
      totals: { repositories: 0, files: 0, lines: 0 },
    };
    await writeDiffCache(dataDir, "one", cache);
    expect(await readDiffCache(dataDir, "one")).toEqual(cache);
  });
});

describe("updateComments", () => {
  it("appends under the lock and bumps updatedAt", async () => {
    await makeSession(dataDir, "one", [comment("c_aaaaaa")]);
    const before = await readReview(dataDir, "one");

    const id = await updateComments(dataDir, "one", (comments) => {
      comments.push(comment("c_bbbbbb"));
      return "c_bbbbbb";
    });

    expect(id).toBe("c_bbbbbb");
    expect((await readComments(dataDir, "one")).map((one) => one.id)).toEqual([
      "c_aaaaaa",
      "c_bbbbbb",
    ]);
    expect((await readReview(dataDir, "one")).updatedAt > before.updatedAt).toBe(true);
    expect(readdirSync(sessionDir(dataDir, "one")).sort()).toEqual([
      "comments.json",
      "review.json",
    ]);
  });

  it("refuses a session that is not there without making a directory for it", async () => {
    await expect(updateComments(dataDir, "typo", () => undefined)).rejects.toThrow(
      /no such review session/,
    );
    expect(existsSync(sessionDir(dataDir, "typo"))).toBe(false);
  });

  it("leaves the file untouched when the change throws", async () => {
    await makeSession(dataDir, "one", [comment("c_aaaaaa")]);
    await expect(
      updateComments(dataDir, "one", () => {
        throw new Error("no");
      }),
    ).rejects.toThrow("no");

    expect((await readComments(dataDir, "one")).map((one) => one.id)).toEqual(["c_aaaaaa"]);
    expect(readdirSync(sessionDir(dataDir, "one"))).not.toContain(".lock");
  });
});

describe("withLock", () => {
  it("releases the lock when the body throws", async () => {
    const dir = sessionDir(dataDir, "one");
    await makeSession(dataDir, "one");
    await expect(
      withLock(dir, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(readdirSync(dir)).not.toContain(".lock");
  });

  it("refuses a lock another writer still holds", async () => {
    const dir = sessionDir(dataDir, "one");
    await makeSession(dataDir, "one");
    liveLock(dir);

    await expect(withLock(dir, async () => "never", { timeoutMs: 60 })).rejects.toThrow(
      /held by another writer/,
    );
  });

  it("lets exactly one of two writers take over the same stale lock", async () => {
    const dir = sessionDir(dataDir, "one");
    await makeSession(dataDir, "one");
    staleLock(dir);

    const order: string[] = [];
    const body = (label: string) => async (): Promise<string> => {
      order.push(`${label} in`);
      await sleep(30);
      order.push(`${label} out`);
      return label;
    };

    const done = await Promise.all([
      withLock(dir, body("a"), { timeoutMs: 5_000 }),
      withLock(dir, body("b"), { timeoutMs: 5_000 }),
    ]);

    expect(done.sort()).toEqual(["a", "b"]);
    // Neither body ran inside the other: the two takeovers did not both win.
    expect(order.map((step) => step.split(" ")[0])).toEqual([
      order[0]?.split(" ")[0],
      order[0]?.split(" ")[0],
      order[2]?.split(" ")[0],
      order[2]?.split(" ")[0],
    ]);
    expect(order[0]).not.toBe(order[2]);
    expect(readdirSync(dir).sort()).toEqual(["comments.json", "review.json"]);
  });

  it("refuses a write whose lock was taken over while it ran", async () => {
    const dir = sessionDir(dataDir, "one");
    await makeSession(dataDir, "one");

    await expect(
      withLock(
        dir,
        async (lock) => {
          staleLock(dir, "someone else");
          await lock.assertHeld();
        },
        { staleMs: 10 },
      ),
    ).rejects.toThrow(/taken over while this write was in progress/);
  });

  it("takes over a lock past the deadline recorded in it", async () => {
    const dir = sessionDir(dataDir, "one");
    await makeSession(dataDir, "one");
    staleLock(dir);

    await expect(withLock(dir, async () => "taken", { timeoutMs: 1_000 })).resolves.toBe("taken");
    expect(readdirSync(dir)).not.toContain(".lock");
  });
});
