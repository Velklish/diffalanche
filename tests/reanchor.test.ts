/** DA-42: comments stay on their lines after code edits, by blame and then by their text, and a
 * comment whose place is gone is `orphaned` and kept (`docs/SPEC.md` section 5, Phase 3). */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import {
  anchorSources,
  filterChange,
  refreshRepository,
  replaceRepository,
  scanReview,
  writeChangeSet,
} from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import {
  LINE_SIMILARITY,
  locate,
  MATCH_MARGIN,
  MATCH_SCORE,
  similarity,
  windowOf,
} from "../src/core/domain/anchors.ts";
import type { AnchorSources } from "../src/core/domain/index.ts";
import {
  addComment,
  anchorWarnings,
  countReview,
  createSession,
  DomainError,
  exportMarkdown,
  list,
  reanchorRepository,
  reopen,
  resolve,
  useSession,
} from "../src/core/domain/index.ts";
import { parseBlame } from "../src/core/git/blame.ts";
import { fileSourceAt } from "../src/core/git/browse.ts";
import { GitError } from "../src/core/git/errors.ts";
import { blameFrom, readRepositoryChange } from "../src/core/git/index.ts";
import { scan } from "../src/core/index.ts";
import type { Anchor, Comment } from "../src/core/storage/index.ts";
import {
  dataDirOf,
  readComments,
  readDiffCache,
  readReview,
  sessionDir,
  updateComments,
  withLock,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import { parseComments, toJson } from "../src/core/storage/schema.ts";
import type { WatcherEvent } from "../src/core/watcher/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";
import { comment as fixtureComment } from "./helpers/session.ts";

const REPO = "repos/group/calc";
const FILE = "src/calc.ts";
const HUMAN = { author: "kim.p", role: "human" } as const;

/** The base revision: three functions, twenty lines. */
const BASE = [
  "export function total(items: Item[]): number {",
  "  let sum = 0;",
  "  for (const item of items) {",
  "    sum += item.price * item.quantity;",
  "  }",
  "  return sum;",
  "}",
  "",
  "export function average(items: Item[]): number {",
  "  if (items.length === 0) return 0;",
  "  return total(items) / items.length;",
  "}",
  "",
  "export function cheapest(items: Item[]): Item | null {",
  "  let best: Item | null = null;",
  "  for (const item of items) {",
  "    if (best === null || item.price < best.price) best = item;",
  "  }",
  "  return best;",
  "}",
];

/** What an agent added on top of the base, lines 13 to 17 of the working tree. */
const ADDED = [
  "",
  "export function discount(items: Item[], rate: number): number {",
  "  const gross = total(items);",
  "  return gross - gross * rate;",
  "}",
];

/** The working tree the comments are written on: the base with `discount` after `average`. */
const WORKTREE = [...BASE.slice(0, 12), ...ADDED, ...BASE.slice(12)];

/** Five lines an edit puts at the top of the file. */
const HEADER = [
  "// Prices are in cents.",
  "// Quantities are whole numbers.",
  "// Nothing here rounds.",
  "// Nothing here throws.",
  "",
];

const noUi: UiAssets = { read: async () => null };

let root: string;
let dataDir: string;
let config: Config;
let sources: AnchorSources;
let sessions = 0;
let session = "";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  });
}

function write(lines: string[]): void {
  writeFileSync(join(root, REPO, FILE), `${lines.join("\n")}\n`);
}

/** A session of its own for every test, scanned on the working tree `WORKTREE`. */
async function freshSession(): Promise<void> {
  sessions += 1;
  session = `t${sessions}`;
  write(WORKTREE);
  await createSession(dataDir, session, { mode: "head" });
  const { cache } = await scanReview(config, { mode: "head" });
  await writeDiffCache(dataDir, session, cache);
}

async function commentOn(line: number, extra: { endLine?: number; side?: "old" } = {}) {
  return addComment(
    dataDir,
    session,
    {
      repo: REPO,
      path: FILE,
      line,
      ...extra,
      severity: "warning",
      body: `about line ${line}`,
      ...HUMAN,
    },
    { source: fileSourceAt(root) },
  );
}

/** Rewrites the file, patches `diff.json` as a rescan does, and re-anchors from the two entries. */
async function edit(lines: string[], using: AnchorSources = sources) {
  const cached = await readDiffCache(dataDir, session);
  const before = cached?.repositories.find((one) => one.path === REPO) ?? null;
  write(lines);
  const change = filterChange(
    null,
    await readRepositoryChange(root, REPO, { mode: "head" }, { hunks: true }),
  );
  if (cached !== null && cached.rootWarnings !== undefined) {
    await writeDiffCache(
      dataDir,
      session,
      replaceRepository({ ...cached, rootWarnings: cached.rootWarnings }, change),
    );
  }
  const after = change.files.length === 0 ? null : change;
  return reanchorRepository(dataDir, session, { repo: REPO, before, after }, using);
}

async function stored(id: string): Promise<Comment> {
  const found = (await readComments(dataDir, session)).find((one) => one.id === id);
  if (found === undefined) throw new Error(`no comment ${id}`);
  return found;
}

function commitAll(dir: string, message: string): void {
  git(dir, ["-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qam", message]);
}

type Isolated = {
  root: string;
  dir: string;
  dataDir: string;
  config: Config;
  write: (lines: string[], path?: string) => void;
  commentOn: (line: number, path?: string) => Promise<Comment>;
  /** What `comment`, `diff` and a rescan all do: the repository read again, the pass after it. */
  refresh: () => ReturnType<typeof refreshRepository>;
  stored: (id: string) => Promise<Comment>;
  cleanup: () => void;
};

/** A root of its own, for a test that moves HEAD, the index or the stash, which the shared
 * repository's other tests stand on. The session `iso` is scanned on `WORKTREE`. */
async function isolatedRoot(): Promise<Isolated> {
  const at = mkdtempSync(join(tmpdir(), "diffalanche-reanchor-iso-"));
  mkdirSync(join(at, ".diffalanche"), { recursive: true });
  writeFileSync(join(at, ".diffalanche", "config.json"), toJson({ roots: ["repos"], depth: 2 }));
  const dir = join(at, REPO);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, FILE), `${BASE.join("\n")}\n`);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  commitAll(dir, "base");
  writeFileSync(join(dir, FILE), `${WORKTREE.join("\n")}\n`);
  const data = dataDirOf(at);
  const own = await loadConfig({ root: at });
  await createSession(data, "iso", { mode: "head" });
  await writeDiffCache(data, "iso", (await scanReview(own, { mode: "head" })).cache);
  const stored = async (id: string) => {
    const found = (await readComments(data, "iso")).find((one) => one.id === id);
    if (found === undefined) throw new Error(`no comment ${id}`);
    return found;
  };
  return {
    root: at,
    dir,
    dataDir: data,
    config: own,
    write: (lines, path = FILE) => writeFileSync(join(dir, path), `${lines.join("\n")}\n`),
    commentOn: (line, path = FILE) =>
      addComment(
        data,
        "iso",
        { repo: REPO, path, line, severity: "warning", body: `line ${line}`, ...HUMAN },
        { source: fileSourceAt(at) },
      ),
    refresh: () => refreshRepository(own, "iso", { mode: "head" }, REPO, null),
    stored,
    cleanup: () => rmSync(at, { recursive: true, force: true }),
  };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-reanchor-"));
  mkdirSync(join(root, ".diffalanche"), { recursive: true });
  writeFileSync(join(root, ".diffalanche", "config.json"), toJson({ roots: ["repos"], depth: 2 }));
  const dir = join(root, REPO);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, FILE), `${BASE.join("\n")}\n`);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "base"]);
  dataDir = dataDirOf(root);
  config = await loadConfig({ root });
  sources = anchorSources(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await freshSession();
});

describe("re-anchoring a line comment", () => {
  it("moves a comment by five when five lines are inserted above it", async () => {
    const added = await commentOn(15);
    expect(added.anchor?.lineContent).toBe("  const gross = total(items);");

    const outcome = await edit([...HEADER, ...WORKTREE]);

    expect(outcome).toEqual({ moved: [added.id], orphaned: [] });
    const moved = await stored(added.id);
    expect(moved).toMatchObject({ line: 20, status: "open" });
    // The context is read again where the comment now is.
    expect(moved.anchor?.lineContent).toBe("  const gross = total(items);");
    expect(moved.anchor?.before).toEqual([
      "}",
      "",
      "export function discount(items: Item[], rate: number): number {",
    ]);
  });

  it("moves a line the base has by blame, and a range by the same five", async () => {
    const context = await commentOn(4);
    const range = await commentOn(14, { endLine: 17 });

    await edit([...HEADER, ...WORKTREE]);

    expect(await stored(context.id)).toMatchObject({ line: 9, endLine: null, status: "open" });
    expect(await stored(range.id)).toMatchObject({ line: 19, endLine: 22, status: "open" });
  });

  it("marks a comment orphaned when its line is rewritten past the threshold, and keeps the anchor", async () => {
    const added = await commentOn(15);
    const rewritten = WORKTREE.map((line, at) =>
      at === 14 ? '  throw new Error("discounts are not supported");' : line,
    );

    const outcome = await edit([...HEADER, ...rewritten]);

    expect(outcome).toEqual({ moved: [], orphaned: [added.id] });
    const orphan = await stored(added.id);
    expect(orphan.status).toBe("orphaned");
    // The old place and the original anchor text stay in comments.json.
    expect(orphan.line).toBe(15);
    expect(orphan.anchor).toEqual(added.anchor);
    const file = readFileSync(join(dataDir, "reviews", session, "comments.json"), "utf8");
    expect(file).toContain('"lineContent": "  const gross = total(items);"');
  });

  it("follows a line edited within the threshold and stores its new text", async () => {
    const added = await commentOn(16);
    const edited = WORKTREE.map((line, at) =>
      at === 15 ? "  return gross - gross * rate / 100;" : line,
    );

    await edit([...HEADER, ...edited]);

    const moved = await stored(added.id);
    expect(moved).toMatchObject({ line: 21, status: "open" });
    expect(moved.anchor?.lineContent).toBe("  return gross - gross * rate / 100;");
  });

  it("finds a line the text alone cannot tell apart, by blame", async () => {
    // `  }` closing the loop of `total`: the lines around it rewritten, the line itself untouched.
    const brace = await commentOn(5);
    const rewritten = [
      "export function total(items: Item[]): number {",
      "  let accumulated = 0;",
      "  for (const entry of items) {",
      "    accumulated += entry.price * entry.quantity;",
      "  }",
      "  return accumulated;",
      "}",
      ...WORKTREE.slice(7),
    ];

    await edit([...HEADER, ...rewritten]);
    expect(await stored(brace.id)).toMatchObject({ line: 10, status: "open" });
  });

  it("orphans that line when blame has no answer, which is what the blame step is for", async () => {
    const brace = await commentOn(5);
    const rewritten = [
      "export function total(items: Item[]): number {",
      "  let accumulated = 0;",
      "  for (const entry of items) {",
      "    accumulated += entry.price * entry.quantity;",
      "  }",
      "  return accumulated;",
      "}",
      ...WORKTREE.slice(7),
    ];
    const blind: AnchorSources = { ...sources, blame: async () => null };

    await edit([...HEADER, ...rewritten], blind);
    expect((await stored(brace.id)).status).toBe("orphaned");
  });

  it("leaves a resolved comment resolved where it was when its line is gone", async () => {
    const added = await commentOn(15);
    await resolve(dataDir, session, added.id, HUMAN);
    const rewritten = WORKTREE.map((line, at) =>
      at === 14 ? '  throw new Error("discounts are not supported");' : line,
    );

    const outcome = await edit(rewritten);

    expect(outcome).toEqual({ moved: [], orphaned: [] });
    expect(await stored(added.id)).toMatchObject({ status: "resolved", line: 15 });
  });

  it("does not touch an orphaned comment again, even when its text comes back", async () => {
    const added = await commentOn(15);
    const rewritten = WORKTREE.map((line, at) =>
      at === 14 ? '  throw new Error("discounts are not supported");' : line,
    );
    await edit(rewritten);
    expect((await stored(added.id)).status).toBe("orphaned");

    const outcome = await edit([...HEADER, ...WORKTREE]);

    expect(outcome).toEqual({ moved: [], orphaned: [] });
    expect(await stored(added.id)).toMatchObject({ status: "orphaned", line: 15 });
  });

  it("orphans a comment whose file is gone", async () => {
    const added = await commentOn(15);
    const cached = await readDiffCache(dataDir, session);
    const before = cached?.repositories.find((one) => one.path === REPO) ?? null;
    rmSync(join(root, REPO, FILE));
    const change = await readRepositoryChange(root, REPO, { mode: "head" }, { hunks: true });

    const outcome = await reanchorRepository(
      dataDir,
      session,
      { repo: REPO, before, after: change },
      sources,
    );

    expect(outcome.orphaned).toEqual([added.id]);
  });

  it("leaves an old-side comment alone while the base has not moved", async () => {
    const old = await commentOn(10, { side: "old" });
    const outcome = await edit([...HEADER, ...WORKTREE]);
    expect(outcome.moved).not.toContain(old.id);
    expect(await stored(old.id)).toMatchObject({ line: 10, side: "old", status: "open" });
  });

  it("follows an old-side comment to the base it has now, once the base moved", async () => {
    // A root of its own: a commit here moves HEAD, which is every other test's base.
    const other = mkdtempSync(join(tmpdir(), "diffalanche-reanchor-base-"));
    try {
      const repo = "repos/group/moved";
      const dir = join(other, repo);
      mkdirSync(dir, { recursive: true });
      const commit = (message: string) =>
        git(dir, [
          "-c",
          "user.email=f@example.com",
          "-c",
          "user.name=f",
          "commit",
          "-qam",
          message,
        ]);
      writeFileSync(join(dir, "f.txt"), "a\nb\nc\nd\ne\n");
      git(dir, ["init", "-q", "-b", "main"]);
      git(dir, ["add", "-A"]);
      commit("first");
      const first = git(dir, ["rev-parse", "HEAD"]).trim();
      writeFileSync(join(dir, "f.txt"), "new 1\nnew 2\na\nb\nc\nd\ne\n");
      commit("second");
      const second = git(dir, ["rev-parse", "HEAD"]).trim();

      const data = join(other, ".diffalanche");
      await createSession(data, "moved", { mode: "head" });
      const change = (sha: string) => ({
        path: repo,
        branch: "main",
        base: { mode: "head" as const, ref: "HEAD", sha },
        files: [],
        warnings: [],
      });
      await writeDiffCache(data, "moved", {
        version: 2,
        base: { mode: "head" },
        scope: null,
        rootWarnings: [],
        root: other,
        repositories: [change(first)],
        totals: { repositories: 1, files: 0, lines: 0 },
        warnings: [],
      });
      const written = await addComment(
        data,
        "moved",
        { repo, path: "f.txt", line: 3, side: "old", severity: "nit", body: "c", ...HUMAN },
        { source: fileSourceAt(other) },
      );

      const outcome = await reanchorRepository(
        data,
        "moved",
        { repo, before: change(first), after: change(second) },
        anchorSources(other),
      );

      expect(outcome.moved).toEqual([written.id]);
      const [moved] = await readComments(data, "moved");
      expect(moved).toMatchObject({ side: "old", line: 5, status: "open" });
      expect(moved?.anchor?.before).toEqual(["new 2", "a", "b"]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("writes nothing when nothing moved", async () => {
    const added = await commentOn(15);
    const outcome = await edit([...WORKTREE, "// one more line at the end"]);
    expect(outcome).toEqual({ moved: [], orphaned: [] });
    expect((await stored(added.id)).anchor).toEqual(added.anchor);
  });
});

describe("the thresholds", () => {
  const anchor: Anchor = {
    lineContent: "  const gross = total(items);",
    hunk: "@@ -12,0 +13,5 @@",
    before: ["", "export function discount(items: Item[], rate: number): number {"],
    after: ["  return gross - gross * rate;", "}", ""],
  };
  const around = (line: string): string[] => [
    "export function average(items: Item[]): number {",
    ...anchor.before,
    line,
    ...anchor.after,
  ];

  it("are the ones the cases below were set by", () => {
    expect({ LINE_SIMILARITY, MATCH_SCORE, MATCH_MARGIN }).toEqual({
      LINE_SIMILARITY: 0.6,
      MATCH_SCORE: 0.7,
      MATCH_MARGIN: 0.1,
    });
  });

  it("keep a line with one token changed", () => {
    expect(similarity(anchor.lineContent, "  const gross = sum(items);")).toBeGreaterThan(0.8);
    expect(locate(anchor, around("  const gross = sum(items);"), 1)).toBe(4);
  });

  it("ignore indentation", () => {
    expect(locate(anchor, around("      const gross = total(items);"), 1)).toBe(4);
  });

  it("drop a line rewritten below the line threshold, however well its context agrees", () => {
    const rewritten = '  throw new Error("discounts are not supported");';
    expect(similarity(anchor.lineContent, rewritten)).toBeCloseTo(0.319, 3);
    expect(locate(anchor, around(rewritten), 1)).toBeNull();
  });

  it("drop a line just under the line threshold, though with its context it would score enough", () => {
    const near = "  const cost = count(rows);";
    // Numbers, not the constants: a threshold moved has to fail on `locate`, not on this.
    expect(similarity(anchor.lineContent, near)).toBeCloseTo(0.593, 3);
    // 0.7 × 0.593 + 0.3 × 1 clears the score: the line's own threshold is what refuses it.
    expect(locate(anchor, around(near), 1)).toBeNull();
  });

  it("keep the same line with its context rewritten, when it is the only such line", () => {
    const lines = ["// a", "// b", "  const gross = total(items);", "// c", "// d", "// e"];
    expect(locate(anchor, lines, 1)).toBe(3);
  });

  it("drop a changed line whose context was rewritten too: nothing says it is the same line", () => {
    const lines = ["// a", "// b", "  const gross = sum(items);", "// c", "// d", "// e"];
    expect(similarity(anchor.lineContent, lines[2] as string)).toBeGreaterThan(0.8);
    expect(locate(anchor, lines, 1)).toBeNull();
  });

  it("refuse two places that match within the margin", () => {
    const twice = [...around(anchor.lineContent), ...around(anchor.lineContent)];
    expect(locate(anchor, twice, 1)).toBeNull();
  });

  it("take the context to tell two copies of the line apart", () => {
    const lines = ["  const gross = total(items);", "// unrelated", ...around(anchor.lineContent)];
    expect(locate(anchor, lines, 1)).toBe(6);
  });
});

describe("blame", () => {
  it("maps the boundary's lines and nothing else", () => {
    const boundary = "a".repeat(40);
    const raw = [
      `${"0".repeat(40)} 1 1 2`,
      "author Not Committed Yet",
      "\tX1",
      `${boundary} 1 3 2`,
      "boundary",
      "\ta",
      `${boundary} 2 4`,
      "\tb",
      `${"b".repeat(40)} 5 5 1`,
      `\t${boundary} 9 9`,
    ].join("\n");
    expect([...parseBlame(raw, boundary)]).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it("reads the working tree against the base", async () => {
    write([...HEADER, ...WORKTREE]);
    const dir = join(root, REPO);
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    const lines = await blameFrom(dir, FILE, head, "worktree");
    expect(lines?.get(1)).toBe(6);
    // `cheapest`, below the five lines of `discount` and the five of the header.
    expect(lines?.get(14)).toBe(24);
    // What the header and `discount` added is nobody's in the base.
    expect([...(lines?.values() ?? [])]).not.toContain(1);
  });

  it("writes nothing to the index, even with a stat-dirty file a refresh would rewrite", async () => {
    // A repository of its own, as 02-git.md says a guard must be built: a tracked file whose
    // content is unchanged and whose mtime is old, so git would re-stat it and write.
    const iso = await isolatedRoot();
    try {
      writeFileSync(join(iso.dir, "same.txt"), "unchanged\n");
      git(iso.dir, ["add", "same.txt"]);
      commitAll(iso.dir, "same");
      const old = new Date("2020-01-01T00:00:00Z");
      utimesSync(join(iso.dir, "same.txt"), old, old);
      utimesSync(join(iso.dir, FILE), old, old);
      // `diff-files` compares the stat and reads nothing into the index: it proves the setup.
      expect(() => git(iso.dir, ["diff-files", "--quiet"])).toThrow();
      const index = readFileSync(join(iso.dir, ".git", "index"));
      const head = git(iso.dir, ["rev-parse", "HEAD"]).trim();
      expect(await blameFrom(iso.dir, FILE, head, "worktree")).not.toBeNull();
      expect(readFileSync(join(iso.dir, ".git", "index")).equals(index)).toBe(true);
    } finally {
      iso.cleanup();
    }
  });

  it("has no answer when blame refuses, and the pass goes on by the text", async () => {
    const iso = await isolatedRoot();
    try {
      const added = await iso.commentOn(4);
      // A missing ignore-revs file makes every blame exit 128.
      git(iso.dir, ["config", "blame.ignoreRevsFile", "no-such-file"]);
      const head = git(iso.dir, ["rev-parse", "HEAD"]).trim();
      expect(await blameFrom(iso.dir, FILE, head, "worktree")).toBeNull();
      iso.write([...HEADER, ...WORKTREE]);
      const outcome = await iso.refresh();
      expect(outcome.moved).toEqual([added.id]);
      expect(await iso.stored(added.id)).toMatchObject({ line: 9, status: "open" });
    } finally {
      iso.cleanup();
    }
  });

  it("annotates the working tree when commits sit between the base and HEAD", async () => {
    // A repository of its own: a commit on top of the base would move every other test's HEAD.
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-blame-"));
    try {
      const commit = (message: string) =>
        git(dir, [
          "-c",
          "user.email=f@example.com",
          "-c",
          "user.name=f",
          "commit",
          "-qam",
          message,
        ]);
      writeFileSync(join(dir, "f.txt"), "a\nb\nc\n");
      git(dir, ["init", "-q", "-b", "main"]);
      git(dir, ["add", "-A"]);
      commit("base");
      const base = git(dir, ["rev-parse", "HEAD"]).trim();
      writeFileSync(join(dir, "f.txt"), "a\nb\nc\nd\n");
      commit("on top");
      writeFileSync(join(dir, "f.txt"), "new 1\nnew 2\na\nb\nc\nd\n");
      // `c`, line 3 of the base, is line 5 on disk; HEAD numbers it 3, which is `<base>..`'s answer.
      expect((await blameFrom(dir, "f.txt", base, "worktree"))?.get(3)).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has no answer for a path the history does not have", async () => {
    const dir = join(root, REPO);
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    expect(await blameFrom(dir, "src/nowhere.ts", head, "worktree")).toBeNull();
  });
});

describe("the orphaned status", () => {
  async function orphan(): Promise<Comment> {
    const added = await commentOn(15);
    const rewritten = WORKTREE.map((line, at) =>
      at === 14 ? '  throw new Error("discounts are not supported");' : line,
    );
    await edit(rewritten);
    return added;
  }

  it("is read from comments.json", () => {
    const text = toJson({
      version: 2,
      comments: [
        {
          id: "c_1",
          repo: REPO,
          path: FILE,
          side: "new",
          line: 3,
          endLine: null,
          anchor: null,
          severity: "nit",
          status: "orphaned",
          author: "kim.p",
          role: "human",
          body: "x",
          createdAt: "2026-09-01T00:00:00Z",
          resolvedAt: null,
          resolvedBy: null,
          replies: [],
        },
      ],
    });
    expect(parseComments("comments.json", text).comments[0]?.status).toBe("orphaned");
  });

  it("counts as open, unanswered and in the severity paint, and is not resolved", async () => {
    await orphan();
    const counters = countReview(await list(dataDir, session)).counters;
    expect(counters).toMatchObject({
      total: 1,
      open: 1,
      resolved: 0,
      unanswered: 1,
      awaiting: 0,
      severity: "warning",
    });
  });

  it("is in the export of the open comments, marked", async () => {
    const added = await orphan();
    const listed = await list(dataDir, session, { status: "open" });
    expect(listed.map((one) => one.id)).toEqual([added.id]);
    const review = await readReview(dataDir, session);
    const text = exportMarkdown(review, listed);
    expect(text).toContain("1 open comment");
    expect(text).toContain(`- **warning** · \`${FILE}:15\` · orphaned`);
  });

  it("is one warning per repository, counted", () => {
    const orphaned = { repo: REPO, status: "orphaned" } as const;
    expect(anchorWarnings([orphaned])).toEqual([
      { path: REPO, message: "1 comment lost its anchor" },
    ]);
    expect(anchorWarnings([orphaned, orphaned, { repo: REPO, status: "open" }])).toEqual([
      { path: REPO, message: "2 comments lost their anchor" },
    ]);
  });

  it("stays orphaned through a reopen that names no line, with or without a file to read", async () => {
    const added = await orphan();
    expect(await reopen(dataDir, session, added.id, HUMAN)).toMatchObject({ status: "orphaned" });
    const options = { source: fileSourceAt(root) };
    expect(await reopen(dataDir, session, added.id, HUMAN, options)).toMatchObject({
      status: "orphaned",
      line: 15,
    });
  });

  it("goes back to open on the line a human names, with the anchor taken there", async () => {
    const added = await orphan();
    const reopened = await reopen(
      dataDir,
      session,
      added.id,
      { ...HUMAN, line: 16 },
      { source: fileSourceAt(root) },
    );
    expect(reopened).toMatchObject({ status: "open", line: 16, endLine: null });
    expect(reopened.anchor?.lineContent).toBe("  return gross - gross * rate;");
    expect(await stored(added.id)).toMatchObject({ status: "open", line: 16 });
  });

  it("refuses to re-anchor anything but a line comment", async () => {
    const file = await addComment(dataDir, session, {
      repo: REPO,
      path: FILE,
      severity: "nit",
      body: "the whole file",
      ...HUMAN,
    });
    const refusal = await reopen(dataDir, session, file.id, { ...HUMAN, line: 3 }).catch(
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(DomainError);
    expect((refusal as DomainError).code).toBe("invalid-anchor");
  });
});

describe("the CLI", () => {
  type Result = { code: number; out: string; err: string };

  async function invoke(argv: string[]): Promise<Result> {
    let out = "";
    let err = "";
    const code = await run([...argv, "--root", root, "--review", session], noUi, {
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
      input: async () => "",
    });
    return { code, out, err };
  }

  async function orphan(): Promise<Comment> {
    const added = await commentOn(15);
    const rewritten = WORKTREE.map((line, at) =>
      at === 14 ? '  throw new Error("discounts are not supported");' : line,
    );
    await edit(rewritten);
    return added;
  }

  it("lists orphaned comments among the open and unanswered ones, and alone by their status", async () => {
    const added = await orphan();
    const open = await commentOn(4);
    const orphaned = JSON.parse((await invoke(["list", "--status", "orphaned", "--json"])).out);
    expect(orphaned.map((one: Comment) => one.id)).toEqual([added.id]);
    const listed = JSON.parse((await invoke(["list", "--json"])).out);
    expect(listed.map((one: Comment) => [one.id, one.status])).toEqual([
      [added.id, "orphaned"],
      [open.id, "open"],
    ]);
    const unanswered = JSON.parse((await invoke(["list", "--unanswered", "--json"])).out);
    expect(unanswered.map((one: Comment) => one.id)).toEqual([added.id, open.id]);
  });

  it("says in the warnings of diff how many comments lost their anchor", async () => {
    await orphan();
    const printed = await invoke(["diff"]);
    expect(printed.code).toBe(0);
    expect(printed.err).toContain(`warning: ${REPO}: 1 comment lost its anchor`);
    const json = JSON.parse((await invoke(["diff", "--json"])).out);
    expect(json.warnings).toContainEqual({ path: REPO, message: "1 comment lost its anchor" });
    // The file keeps the scan's own warnings: the orphans are counted on the way out.
    expect((await readDiffCache(dataDir, session))?.warnings).toEqual([]);
  });

  it("keeps an orphaned comment orphaned without --line, and opens it on the line --line names", async () => {
    const added = await orphan();
    const plain = await invoke(["reopen", added.id, "--role", "human"]);
    expect(plain.code).toBe(0);
    expect(plain.out).toBe(
      `${added.id} is open again, orphaned: line 15 does not read as it did; name its line with --line\n`,
    );
    expect((await stored(added.id)).status).toBe("orphaned");
    const reopened = await invoke(["reopen", added.id, "--role", "human", "--line", "16"]);
    expect(reopened.code).toBe(0);
    expect(reopened.out).toBe(`${added.id} is open again on ${REPO}/${FILE}:16\n`);
    expect(await stored(added.id)).toMatchObject({ status: "open", line: 16 });
  });

  it("refuses --line from an agent, as every reopen", async () => {
    const added = await orphan();
    const refused = await invoke(["reopen", added.id, "--line", "16"]);
    expect(refused.code).toBe(1);
    expect((await stored(added.id)).status).toBe("orphaned");
  });
});

/** A line comment put on disk as a writer would, its anchor read off `lines` at `line`. */
async function placedOn(lines: string[], line: number): Promise<string> {
  const anchor = windowOf(lines, line);
  if (anchor === null) throw new Error(`no line ${line}`);
  const id = `c_t${line}x${sessions}`;
  await updateComments(dataDir, session, (comments) => {
    comments.push(
      fixtureComment(id, { repo: REPO, path: FILE, line, anchor: { ...anchor, hunk: "@@" } }),
    );
  });
  return id;
}

describe("what a pass trusts", () => {
  it("keeps a comment in place rather than following blame onto a copy of its line", async () => {
    // `}` closes `total` at 7 and `average` at 12; five lines go on top, and the comment is put
    // on the new tree's 12 — `total`'s — while diff.json still describes the tree before.
    const tree = [...HEADER, ...WORKTREE];
    write(tree);
    const id = await placedOn(tree, 12);
    const outcome = await edit(tree);
    expect(outcome.moved).toEqual([]);
    expect(await stored(id)).toMatchObject({ line: 12, status: "open" });
  });

  it("asks blame nothing when the tree it maps from is not the one the comment was put on", async () => {
    // The same stale diff.json, and one more line on top: blame from that tree would land on
    // `average`'s brace; the text finds `total`'s one line down.
    const tree = [...HEADER, ...WORKTREE];
    write(tree);
    const id = await placedOn(tree, 12);
    await edit(["// one more", ...tree]);
    expect(await stored(id)).toMatchObject({ line: 13, status: "open" });
  });

  it("keeps a comment in place even when blame names a copy of its whole window", async () => {
    // The tree before is the one the comment was put on, so only the order of the steps is left:
    // `total` and the start of `average` appended again, and a blame that says the copy is it.
    const brace = await commentOn(7);
    const next = [...WORKTREE, ...WORKTREE.slice(0, 10)];
    const copy = WORKTREE.length + 7;
    const other: AnchorSources = { ...sources, blame: async () => new Map([[7, copy]]) };
    await edit(next, other);
    expect(await stored(brace.id)).toMatchObject({ line: 7, status: "open" });
  });

  it("does not take blame's word from a tree the comment was not put on, however well it reads", async () => {
    // A copy of `total` at the end: its `}` has the three lines before it the comment has, so
    // a landing there clears the context check, and only the tree check refuses it.
    const tree = [...HEADER, ...WORKTREE];
    write(tree);
    const id = await placedOn(tree, 12);
    const next = ["// one more", ...tree, ...tree.slice(5, 12)];
    const copy = next.length;
    const stale: AnchorSources = { ...sources, blame: async () => new Map([[12, copy]]) };
    await edit(next, stale);
    expect(await stored(id)).toMatchObject({ line: 13, status: "open" });
  });

  it("does not take a blame landing whose context disagrees with the anchor", async () => {
    const brace = await commentOn(7);
    // What an ignore-revs file can make blame say: `total`'s brace is `average`'s now.
    const lying: AnchorSources = { ...sources, blame: async () => new Map([[7, 17]]) };
    await edit([...HEADER, ...WORKTREE], lying);
    expect(await stored(brace.id)).toMatchObject({ line: 12, status: "open" });
  });
});

describe("a file that changed its name or went away", () => {
  it("carries a comment into the file a `git mv` renamed", async () => {
    const iso = await isolatedRoot();
    try {
      const added = await iso.commentOn(15);
      git(iso.dir, ["mv", FILE, "src/money.ts"]);
      // A rename that changed lines too, which the parser used to read as a modified new file.
      const seen = await readRepositoryChange(iso.root, REPO, { mode: "head" }, { hunks: true });
      expect(seen.files.map((one) => [one.path, one.status, one.oldPath])).toEqual([
        ["src/money.ts", "renamed", FILE],
      ]);
      const outcome = await iso.refresh();
      expect(outcome.moved).toEqual([added.id]);
      expect(await iso.stored(added.id)).toMatchObject({
        path: "src/money.ts",
        line: 15,
        status: "open",
      });
    } finally {
      iso.cleanup();
    }
  });

  it("reads a plain mv as git does, a deletion and an untracked file, and orphans the comment", async () => {
    const iso = await isolatedRoot();
    try {
      const added = await iso.commentOn(15);
      renameSync(join(iso.dir, FILE), join(iso.dir, "src/money.ts"));
      const change = await readRepositoryChange(iso.root, REPO, { mode: "head" }, { hunks: true });
      expect(change.files.map((one) => [one.path, one.status, one.oldPath])).toEqual([
        [FILE, "deleted", null],
        ["src/money.ts", "added", null],
      ]);
      const outcome = await iso.refresh();
      expect(outcome.orphaned).toEqual([added.id]);
    } finally {
      iso.cleanup();
    }
  });

  it("leaves a comment alone while its added file is stashed, and finds it there after the pop", async () => {
    const iso = await isolatedRoot();
    try {
      iso.write(
        ["export const a = 1;", "export const b = 2;", "export const c = 3;"],
        "src/extra.ts",
      );
      await iso.refresh();
      const added = await iso.commentOn(2, "src/extra.ts");
      // A tracked file stashed back to its base reads, without the line: that one is orphaned,
      // and stays so after the pop — DA-42.4's first question.
      const tracked = await iso.commentOn(15);
      git(iso.dir, ["add", "src/extra.ts"]);
      git(iso.dir, ["-c", "user.email=f@example.com", "-c", "user.name=f", "stash", "-q"]);
      await iso.refresh();
      expect(await iso.stored(added.id)).toMatchObject({ line: 2, status: "open" });
      expect((await iso.stored(tracked.id)).status).toBe("orphaned");
      git(iso.dir, ["stash", "pop", "-q"]);
      await iso.refresh();
      expect(await iso.stored(added.id)).toMatchObject({ line: 2, status: "open" });
      expect((await iso.stored(tracked.id)).status).toBe("orphaned");
    } finally {
      iso.cleanup();
    }
  });

  it("leaves a comment alone when its file cannot be read though the change set lists it", async () => {
    const added = await commentOn(15);
    const unread: AnchorSources = {
      ...sources,
      source: async (repo, path, rev) =>
        rev === "worktree" ? null : sources.source(repo, path, rev),
    };
    const outcome = await edit([...HEADER, ...WORKTREE], unread);
    expect(outcome).toEqual({ moved: [], orphaned: [] });
    expect(await stored(added.id)).toMatchObject({ line: 15, status: "open" });
  });
});

describe("what a pass writes", () => {
  it("writes nothing, and leaves updatedAt, when only the hunk header of an anchor moved", async () => {
    await commentOn(15);
    const file = join(dataDir, "reviews", session, "comments.json");
    const bytes = readFileSync(file, "utf8");
    const updated = (await readReview(dataDir, session)).updatedAt;
    // Line 10 is outside the comment's window and inside its hunk, whose header now starts higher.
    const edited = WORKTREE.map((line, at) => (at === 9 ? "  if (!items.length) return 0;" : line));
    const outcome = await edit(edited);
    expect(outcome).toEqual({ moved: [], orphaned: [] });
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect((await readReview(dataDir, session)).updatedAt).toBe(updated);
  });

  it("grows a range when a line is inserted inside it", async () => {
    const range = await commentOn(14, { endLine: 17 });
    const grown = [...WORKTREE.slice(0, 15), "  // the rate is a fraction", ...WORKTREE.slice(15)];
    await edit(grown);
    expect(await stored(range.id)).toMatchObject({ line: 14, endLine: 18, status: "open" });
  });

  it("narrows a range to what still reads the same when its end is gone", async () => {
    const range = await commentOn(14, { endLine: 17 });
    const cut = [...WORKTREE.slice(0, 15), "  return 0;", ...WORKTREE.slice(17)];
    await edit(cut);
    expect(await stored(range.id)).toMatchObject({ line: 14, endLine: 15, status: "open" });
  });

  it("reads an old-side comment's tree under the name the base had the file by", async () => {
    // A renamed file whose base moved: the tree is the old base's `calc.ts`, and blame from it is
    // what tells two copies of the window apart; read under the new name, it is never asked.
    const window = ["a", "b", "c", "d", "e", "f", "g"];
    const [oldSha, newSha] = ["a".repeat(40), "b".repeat(40)];
    const renamed = {
      path: "src/money.ts",
      oldPath: FILE,
      status: "renamed" as const,
      additions: 0,
      deletions: 0,
      patch: "",
      hunks: [],
      omitted: null,
    };
    const entry = (sha: string) => ({
      path: REPO,
      branch: "main",
      base: { mode: "head" as const, ref: "HEAD", sha },
      files: [renamed],
      warnings: [],
    });
    const id = `c_oldside${sessions}`;
    const anchor = { ...(windowOf(window, 4) as Anchor), hunk: "@@" };
    await updateComments(dataDir, session, (comments) => {
      comments.push(
        fixtureComment(id, { repo: REPO, path: "src/money.ts", side: "old", line: 4, anchor }),
      );
    });
    const texts = new Map([
      [oldSha, `${window.join("\n")}\n`],
      [newSha, `${["new", ...window, ...window].join("\n")}\n`],
    ]);
    const spied: AnchorSources = {
      source: async (_repo, path, rev) =>
        path === FILE && rev !== "worktree" ? (texts.get(rev.sha) ?? null) : null,
      blame: async (_repo, path, boundary) =>
        path === FILE && boundary === oldSha ? new Map([[4, 12]]) : null,
    };
    const move = { repo: REPO, before: entry(oldSha), after: entry(newSha) };
    await reanchorRepository(dataDir, session, move, spied);
    expect(await stored(id)).toMatchObject({ line: 12, status: "open" });
  });

  it("leaves an old-side comment alone when the entry after names no base", async () => {
    const old = await commentOn(10, { side: "old" });
    const cached = await readDiffCache(dataDir, session);
    const before = cached?.repositories.find((one) => one.path === REPO) ?? null;
    write(BASE);
    const outcome = await reanchorRepository(
      dataDir,
      session,
      { repo: REPO, before, after: null },
      sources,
    );
    expect(outcome).toEqual({ moved: [], orphaned: [] });
    expect(await stored(old.id)).toMatchObject({ line: 10, side: "old", status: "open" });
  });
});

describe("the writers of diff.json", () => {
  it("moves the comments when `diff` rewrites the change set with no server running", async () => {
    const added = await commentOn(15);
    write([...HEADER, ...WORKTREE]);
    const printed = await run(["diff", "--root", root, "--review", session], noUi, {
      out: () => {},
      err: () => {},
    });
    expect(printed).toBe(0);
    expect(await stored(added.id)).toMatchObject({ line: 20, status: "open" });
  });

  it("moves the comments when `comment` reads the repository again before it writes", async () => {
    const added = await commentOn(15);
    write([...HEADER, ...WORKTREE]);
    const code = await run(
      [
        ...["comment", "--repo", REPO, "--path", FILE, "--line", "4", "--severity", "nit"],
        ...["--body", "another", "--root", root, "--review", session],
      ],
      noUi,
      { out: () => {}, err: () => {} },
    );
    expect(code).toBe(0);
    expect(await stored(added.id)).toMatchObject({ line: 20, status: "open" });
  });

  it("exits 0 with a warning when comments.json cannot be read, and the next run moves them", async () => {
    const added = await commentOn(15);
    const file = join(dataDir, "reviews", session, "comments.json");
    const kept = readFileSync(file, "utf8");
    writeFileSync(file, "{ not json");
    write([...HEADER, ...WORKTREE]);
    let err = "";
    const code = await run(["diff", "--root", root, "--review", session], noUi, {
      out: () => {},
      err: (text) => {
        err += text;
      },
    });
    expect(code).toBe(0);
    expect(err).toContain("comments.json: cannot be read, so no comment was re-anchored");
    expect(readFileSync(file, "utf8")).toBe("{ not json");
    // The entry is still the tree the comments are on, so the moves are not lost.
    expect(await cachedTopLine()).toBe(WORKTREE[0]);
    writeFileSync(file, kept);
    await run(["diff", "--root", root, "--review", session], noUi, {
      out: () => {},
      err: () => {},
    });
    expect(await stored(added.id)).toMatchObject({ line: 20, status: "open" });
    expect(await cachedTopLine()).toBe(HEADER[0]);
  });

  it("keeps the entry and says why when the pass fails, and the next writer moves the comments", async () => {
    const added = await commentOn(15);
    write([...HEADER, ...WORKTREE]);
    const failing: AnchorSources = {
      ...sources,
      source: async () => {
        throw new GitError("not-started", "git could not be started", null, "");
      },
    };
    const written = await rewrite({ sources: failing });
    expect(written.failure).toBeInstanceOf(GitError);
    expect(written.pending).toEqual([REPO]);
    expect(await cachedTopLine()).toBe(WORKTREE[0]);
    expect((await stored(added.id)).line).toBe(15);
    await rewrite();
    expect(await stored(added.id)).toMatchObject({ line: 20, status: "open" });
  });

  it("leaves a repository to the next writer when the pass runs out of its share of the lease", async () => {
    const added = await commentOn(15);
    write([...HEADER, ...WORKTREE]);
    const written = await rewrite({ budgetMs: 0 });
    expect(written).toMatchObject({ failure: null, pending: [REPO], moved: [] });
    expect(await cachedTopLine()).toBe(WORKTREE[0]);
    await rewrite();
    expect(await stored(added.id)).toMatchObject({ line: 20, status: "open" });
  });
});

/** The first line the cached entry of the calc file's first hunk carries on the new side. */
async function cachedTopLine(): Promise<string | undefined> {
  const cache = await readDiffCache(dataDir, session);
  const hunks = cache?.repositories.find((one) => one.path === REPO)?.files[0]?.hunks ?? [];
  const numbered = hunks.flatMap((hunk) => hunk.lines).filter((one) => one.newLine === 1);
  return numbered[0]?.content ?? WORKTREE[0];
}

/** A writer's rewrite of the change set, as `diff` does it, with a test's own options. */
async function rewrite(options: Parameters<typeof writeChangeSet>[5] = {}) {
  const { cache } = await scanReview(config, { mode: "head" });
  return withLock(sessionDir(dataDir, session), (held) =>
    writeChangeSet(config, session, held, cache, undefined, options),
  );
}

describe("reopening", () => {
  async function orphan(): Promise<Comment> {
    const added = await commentOn(15);
    const rewritten = WORKTREE.map((line, at) =>
      at === 14 ? '  throw new Error("discounts are not supported");' : line,
    );
    await edit(rewritten);
    return added;
  }

  it("opens a comment that was orphaned and then resolved as orphaned again", async () => {
    const added = await orphan();
    await resolve(dataDir, session, added.id, HUMAN);
    const reopened = await reopen(dataDir, session, added.id, HUMAN, {
      source: fileSourceAt(root),
    });
    expect(reopened).toMatchObject({ status: "orphaned", line: 15, resolvedBy: null });
  });

  it("opens a resolved comment whose line is gone as orphaned, and one in place as open", async () => {
    const gone = await commentOn(15);
    const kept = await commentOn(4);
    await resolve(dataDir, session, gone.id, HUMAN);
    await resolve(dataDir, session, kept.id, HUMAN);
    await edit(WORKTREE.map((line, at) => (at === 14 ? "  throw new Error();" : line)));
    const options = { source: fileSourceAt(root) };
    expect(await reopen(dataDir, session, gone.id, HUMAN, options)).toMatchObject({
      status: "orphaned",
      line: 15,
    });
    expect(await reopen(dataDir, session, kept.id, HUMAN, options)).toMatchObject({
      status: "open",
      line: 4,
    });
  });

  it("does both from the page's route, which reads the repository first as the CLI does", async () => {
    const gone = await commentOn(15);
    const kept = await commentOn(4);
    await resolve(dataDir, session, gone.id, HUMAN);
    await resolve(dataDir, session, kept.id, HUMAN);
    // The edit is on disk only: the route's own read of the repository is what finds it.
    write([...HEADER, ...WORKTREE.map((line, at) => (at === 14 ? "  throw new Error();" : line))]);
    const app = createApp({
      activity: createActivityLog(),
      config,
      events: createEventStream(),
      review: createReviewService(config),
      ui: noUi,
    });
    const reopen = async (id: string) =>
      (await (
        await app.request(`/api/comments/${id}/reopen?review=${session}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).json()) as Comment;
    expect(await reopen(gone.id)).toMatchObject({ status: "orphaned", line: 15 });
    // The resolved comment in place moved with the refresh, five lines down, and opens there.
    expect(await reopen(kept.id)).toMatchObject({ status: "open", line: 9 });
  });
});

describe("the watcher", () => {
  it("re-anchors after an edit, and says so with a thread frame and a warning", async () => {
    const moving = await commentOn(15);
    const losing = await commentOn(16);
    // The session is current, so the watcher follows it.
    await useSession(dataDir, session);
    const bus = createEventBus();
    const seen: WatcherEvent[] = [];
    bus.subscribe((event) => seen.push(event));
    const found = await scan(root, { roots: config.roots, depth: config.depth, exclude: [] });
    const watcher = await startWatcher({
      config,
      scan: found,
      bus,
      activity: createActivityLog(),
      recursive: false,
      pollIntervalMs: 40,
    });
    try {
      const rewritten = WORKTREE.map((line, at) =>
        at === 15 ? "  return applyRate(gross);" : line,
      );
      write([...HEADER, ...rewritten]);
      const deadline = Date.now() + 20_000;
      for (;;) {
        const moved = await stored(moving.id);
        const lost = await stored(losing.id);
        if (moved.line === 20 && lost.status === "orphaned") break;
        if (Date.now() > deadline) throw new Error("the comments were never re-anchored");
        await new Promise((done) => setTimeout(done, 20));
      }
      const until = Date.now() + 20_000;
      while (!seen.some((event) => event.type === "warnings")) {
        if (Date.now() > until) throw new Error("no warnings frame");
        await new Promise((done) => setTimeout(done, 20));
      }
    } finally {
      await watcher.close();
    }
    expect(seen).toContainEqual({ type: "comment-status", session, id: moving.id });
    expect(seen).toContainEqual({ type: "comment-status", session, id: losing.id });
    const warnings = seen.filter((event) => event.type === "warnings").at(-1);
    expect(warnings).toEqual({
      type: "warnings",
      list: [{ path: REPO, message: "1 comment lost its anchor" }],
    });
  }, 60_000);

  it("finds the comments moved when a CLI command rewrote diff.json before the rescan came", async () => {
    const moving = await commentOn(15);
    await useSession(dataDir, session);
    const found = await scan(root, { roots: config.roots, depth: config.depth, exclude: [] });
    // A long debounce, so the command's refresh lands first and the rescan finds nothing new.
    const watcher = await startWatcher({
      config,
      scan: found,
      bus: createEventBus(),
      activity: createActivityLog(),
      recursive: false,
      pollIntervalMs: 40,
      debounceMs: 1_000,
    });
    try {
      await watcher.refresh();
      write([...HEADER, ...WORKTREE]);
      // What `comment` and `diff` do to the cache before they write.
      await refreshRepository(config, session, { mode: "head" }, REPO, null);
      const deadline = Date.now() + 20_000;
      while ((await stored(moving.id)).line !== 20) {
        if (Date.now() > deadline) throw new Error("the comment never moved");
        await new Promise((done) => setTimeout(done, 20));
      }
    } finally {
      await watcher.close();
    }
  }, 60_000);
});
