import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import {
  addComment,
  countReview,
  createSession,
  DomainError,
  exportMarkdown,
  get,
  isAwaiting,
  isUnanswered,
  list,
  reopen,
  reply,
  resolve,
} from "../src/core/domain/index.ts";
import type { Comment } from "../src/core/storage/index.ts";
import { dataDirOf, readComments, readReview, writeDiffCache } from "../src/core/storage/index.ts";
import { readHunks } from "./helpers/change-set.ts";

const SMALL = PROFILES.small;
const REPO = "repos/core/cargos-api";
const SESSION = "work";
const HUMAN = { author: "kim.p", role: "human" } as const;
const AGENT = { author: "claude", role: "agent" } as const;

let root: string;
let dataDir: string;
/** A changed file of the fixture and a line the change set really has. */
let file: string;
let line: number;
let statusBefore: string;

function status(): string {
  return execFileSync("git", ["-C", join(root, REPO), "status", "--porcelain"], {
    encoding: "utf8",
  });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-comments-"));
  generate({ out: root, seed: 7, profile: SMALL });
  dataDir = dataDirOf(root);

  await createSession(dataDir, SESSION, { mode: "head" }, "Anchors");
  const repository = readHunks(root, REPO);
  await writeDiffCache(dataDir, SESSION, {
    version: 1,
    root,
    repositories: [repository],
    totals: { repositories: 1, files: repository.files.length, lines: 0 },
    warnings: [],
  });

  const target = repository.files.find((one) => one.hunks.length > 0);
  const inserted = target?.hunks[0]?.lines.find(
    (one) => one.newLine !== null && one.oldLine === null,
  );
  file = target?.path as string;
  line = inserted?.newLine as number;
  statusBefore = status();
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function write(input: Parameters<typeof addComment>[2]): Promise<Comment> {
  return addComment(dataDir, SESSION, input);
}

describe("anchor levels", () => {
  it("round-trips every level through storage with the right nulls", async () => {
    const written = [
      await write({ severity: "question", body: "the whole review", ...HUMAN }),
      await write({ repo: REPO, severity: "nit", body: "this repository", ...HUMAN }),
      await write({ repo: REPO, path: file, severity: "warning", body: "this file", ...HUMAN }),
      await write({
        repo: REPO,
        path: file,
        line,
        severity: "critical",
        body: "this line",
        ...HUMAN,
      }),
      await write({
        repo: REPO,
        path: file,
        line,
        endLine: line + 2,
        severity: "warning",
        body: "these lines",
        ...HUMAN,
      }),
    ];

    const stored = await readComments(dataDir, SESSION);
    for (const comment of written) {
      expect(stored.find((one) => one.id === comment.id)).toEqual(comment);
      expect(comment.id).toMatch(/^c_[0-9a-z]{6}$/);
    }

    expect(written[0]).toMatchObject({
      repo: null,
      path: null,
      side: null,
      line: null,
      anchor: null,
    });
    expect(written[1]).toMatchObject({ repo: REPO, path: null, line: null, anchor: null });
    expect(written[2]).toMatchObject({ path: file, side: null, line: null, anchor: null });
    expect(written[3]).toMatchObject({ line, endLine: null, side: "new" });
    expect(written[4]).toMatchObject({ line, endLine: line + 2, side: "new" });
    expect(written[3]?.anchor).not.toBeNull();
  });

  it("refuses levels that do not add up", async () => {
    const cases: Parameters<typeof addComment>[2][] = [
      { path: "a.ts", severity: "nit", body: "file without repository", ...HUMAN },
      { repo: REPO, line: 3, severity: "nit", body: "line without file", ...HUMAN },
      { repo: REPO, path: file, endLine: 9, severity: "nit", body: "range without line", ...HUMAN },
      { repo: REPO, path: file, line: 9, endLine: 4, severity: "nit", body: "backwards", ...HUMAN },
    ];
    for (const input of cases) {
      const error = await write(input).catch((caught: unknown) => caught);
      expect((error as DomainError).code).toBe("invalid-anchor");
    }
  });
});

describe("anchor capture", () => {
  it("takes the line and its context from the change set git printed", async () => {
    const comment = await write({
      repo: REPO,
      path: file,
      line,
      severity: "warning",
      body: "anchored",
      ...HUMAN,
    });

    const hunks = readHunks(root, REPO).files.find((one) => one.path === file)?.hunks ?? [];
    const hunk = hunks.find((one) => one.lines.some((l) => l.newLine === line));
    const index = hunk?.lines.findIndex((l) => l.newLine === line) ?? -1;

    expect(comment.anchor?.hunk).toBe(hunk?.header);
    expect(comment.anchor?.hunk).toMatch(/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
    // The line text is the working tree's own line, not a copy of the patch.
    const working = readFileSync(join(root, REPO, file), "utf8").split("\n");
    expect(comment.anchor?.lineContent).toBe(working[line - 1]);
    expect(comment.anchor?.before).toEqual(
      hunk?.lines.slice(Math.max(0, index - 3), index).map((l) => l.content),
    );
    expect(comment.anchor?.after).toEqual(
      hunk?.lines.slice(index + 1, index + 4).map((l) => l.content),
    );
    expect(comment.anchor?.before.length).toBeLessThanOrEqual(3);
    expect(comment.anchor?.after.length).toBeLessThanOrEqual(3);
  });

  it("refuses a line the change set does not have and names the nearest hunk", async () => {
    const error = await write({
      repo: REPO,
      path: file,
      line: 900_000,
      severity: "nit",
      body: "nowhere",
      ...HUMAN,
    }).catch((caught: unknown) => caught);

    expect((error as DomainError).code).toBe("line-not-in-diff");
    expect((error as DomainError).message).toMatch(/the nearest hunk is @@ -\d+/);
  });

  it("refuses a file that is not in the change set", async () => {
    const error = await write({
      repo: REPO,
      path: "never/written.ts",
      line: 1,
      severity: "nit",
      body: "nowhere",
      ...HUMAN,
    }).catch((caught: unknown) => caught);
    expect((error as DomainError).message).toContain("is not in the change set");
  });
});

describe("roles", () => {
  it("refuses resolve and reopen from an agent and changes nothing", async () => {
    const comment = await write({ severity: "warning", body: "for the role check", ...HUMAN });

    for (const action of [resolve, reopen]) {
      const error = await action(dataDir, SESSION, comment.id, AGENT).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("role-not-human");
    }

    expect(await get(dataDir, SESSION, comment.id)).toEqual(comment);
  });

  it("lets a human resolve and reopen", async () => {
    const comment = await write({ severity: "warning", body: "for the human check", ...HUMAN });

    const resolved = await resolve(dataDir, SESSION, comment.id, { ...HUMAN, note: "verified" });
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: "kim.p" });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.replies.at(-1)).toMatchObject({ body: "verified", role: "human" });

    const reopened = await reopen(dataDir, SESSION, comment.id, HUMAN);
    expect(reopened).toMatchObject({ status: "open", resolvedAt: null, resolvedBy: null });
  });

  it("bumps the session's updatedAt on every comment write", async () => {
    const before = await readReview(dataDir, SESSION);
    await write({ severity: "nit", body: "a write", ...HUMAN });
    expect((await readReview(dataDir, SESSION)).updatedAt > before.updatedAt).toBe(true);
  });
});

describe("thread state", () => {
  it("flips unanswered and awaiting with each message", async () => {
    const comment = await write({ severity: "warning", body: "a finding", ...HUMAN });
    expect(isUnanswered(comment)).toBe(true);
    expect(isAwaiting(comment)).toBe(false);

    const answered = await reply(dataDir, SESSION, comment.id, { ...AGENT, body: "fixed" });
    expect(answered.replies.map((one) => one.id)).toEqual(["r_1"]);
    expect(isUnanswered(answered)).toBe(false);
    expect(isAwaiting(answered)).toBe(true);

    const again = await reply(dataDir, SESSION, comment.id, { ...HUMAN, body: "not quite" });
    expect(again.replies.map((one) => one.id)).toEqual(["r_1", "r_2"]);
    expect(isUnanswered(again)).toBe(true);
    expect(isAwaiting(again)).toBe(false);

    // A resolved thread is neither: both are states of an open one.
    const closed = await resolve(dataDir, SESSION, comment.id, HUMAN);
    expect(isUnanswered(closed)).toBe(false);
    expect(isAwaiting(closed)).toBe(false);
  });
});

describe("filters and counters", () => {
  it("filters by status, repository, severity, and unanswered", async () => {
    const all = await list(dataDir, SESSION);
    expect(all.length).toBeGreaterThan(0);

    const open = await list(dataDir, SESSION, { status: "open" });
    expect(open.every((one) => one.status === "open")).toBe(true);
    const resolvedOnes = await list(dataDir, SESSION, { status: "resolved" });
    expect(open.length + resolvedOnes.length).toBe(all.length);

    expect((await list(dataDir, SESSION, { repo: REPO })).every((one) => one.repo === REPO)).toBe(
      true,
    );
    expect(
      (await list(dataDir, SESSION, { severity: "critical" })).every(
        (one) => one.severity === "critical",
      ),
    ).toBe(true);
    expect((await list(dataDir, SESSION, { unanswered: true })).every(isUnanswered)).toBe(true);
  });

  it("counts per review, per repository, and per file with the worst open severity", () => {
    const comments: Comment[] = [
      base("c_000001", { repo: "a", path: "x.ts", severity: "nit" }),
      base("c_000002", { repo: "a", path: "x.ts", severity: "critical" }),
      base("c_000003", { repo: "a", path: "y.ts", severity: "warning", status: "resolved" }),
      base("c_000004", { repo: "b", path: "z.ts", severity: "question" }),
      base("c_000005", { repo: null, path: null, severity: "warning" }),
    ];

    const counted = countReview(comments);
    expect(counted.counters).toMatchObject({
      total: 5,
      open: 4,
      resolved: 1,
      severity: "critical",
    });
    expect(counted.repositories.map((one) => one.repo)).toEqual(["a", "b"]);
    expect(counted.repositories[0]?.counters).toMatchObject({ total: 3, severity: "critical" });
    expect(counted.repositories[0]?.files.map((one) => one.path)).toEqual(["x.ts", "y.ts"]);
    // The only comment on y.ts is resolved, so the file carries no severity.
    expect(counted.repositories[0]?.files[1]?.counters).toMatchObject({
      total: 1,
      open: 0,
      severity: null,
    });
  });
});

describe("a session that is not there", () => {
  it("gives every function the same refusal", async () => {
    const calls: (() => Promise<unknown>)[] = [
      () => list(dataDir, "missing"),
      () => get(dataDir, "missing", "c_aaaaaa"),
      () => addComment(dataDir, "missing", { severity: "nit", body: "review level", ...HUMAN }),
      () =>
        addComment(dataDir, "missing", {
          repo: REPO,
          path: file,
          line,
          severity: "nit",
          body: "line level",
          ...HUMAN,
        }),
      () => reply(dataDir, "missing", "c_aaaaaa", { ...AGENT, body: "hello" }),
      () => resolve(dataDir, "missing", "c_aaaaaa", HUMAN),
      () => reopen(dataDir, "missing", "c_aaaaaa", HUMAN),
    ];

    for (const call of calls) {
      const error = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("no-such-session");
    }
  });
});

describe("markdown export", () => {
  it("keeps a multi-paragraph reply inside the block quote", async () => {
    const comment = await write({ severity: "warning", body: "first\n\nsecond", ...HUMAN });
    await reply(dataDir, SESSION, comment.id, { ...AGENT, body: "one\n\ntwo" });

    const review = await readReview(dataDir, SESSION);
    const markdown = exportMarkdown(review, [await get(dataDir, SESSION, comment.id)]);
    const quoted = markdown.split("\n").filter((one) => one.trim().startsWith(">"));
    // Every line of the reply carries the marker, the blank one included.
    expect(quoted).toEqual(["  > **claude** (agent) — one", "  >", "  > two"]);
    expect(markdown).toContain("  first\n\n  second");
  });

  it("matches the checked-in export of the small fixture", async () => {
    const review = await readReview(dataDir, "synth");
    const comments = await list(dataDir, "synth", { status: "open" });
    await expect(exportMarkdown(review, comments)).toMatchFileSnapshot("snapshots/export-small.md");
  });

  it("leaves the fixture repository exactly as it was", () => {
    // Every comment above was written while this repository sat there; the tool
    // writes to the data directory and nowhere else.
    expect(status()).toBe(statusBefore);
  });
});

/** A comment with only the fields the counters read. */
function base(id: string, fields: Partial<Comment>): Comment {
  return {
    id,
    repo: null,
    path: null,
    side: null,
    line: null,
    endLine: null,
    anchor: null,
    severity: "warning",
    status: "open",
    author: "kim.p",
    role: "human",
    body: "a finding",
    createdAt: "2026-09-01T09:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...fields,
  };
}
