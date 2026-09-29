/** DA-42: comments stay on their lines after code edits, by blame and then by their text, and a
 * comment whose place is gone is `orphaned` and kept (`docs/SPEC.md` section 5, Phase 3). */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import {
  filterChange,
  refreshRepository,
  replaceRepository,
  scanReview,
} from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import {
  LINE_SIMILARITY,
  locate,
  MATCH_MARGIN,
  MATCH_SCORE,
  similarity,
} from "../src/core/domain/anchors.ts";
import type { AnchorSources } from "../src/core/domain/index.ts";
import {
  addComment,
  anchorWarnings,
  countReview,
  createSession,
  DomainError,
  list,
  reanchorRepository,
  reopen,
  resolve,
  useSession,
} from "../src/core/domain/index.ts";
import { parseBlame } from "../src/core/git/blame.ts";
import { fileSourceAt } from "../src/core/git/browse.ts";
import { blameFrom, readRepositoryChange } from "../src/core/git/index.ts";
import { scan } from "../src/core/index.ts";
import type { Anchor, Comment } from "../src/core/storage/index.ts";
import {
  dataDirOf,
  readComments,
  readDiffCache,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import { parseComments, toJson } from "../src/core/storage/schema.ts";
import type { WatcherEvent } from "../src/core/watcher/index.ts";
import {
  anchorSources,
  createActivityLog,
  createEventBus,
  startWatcher,
} from "../src/core/watcher/index.ts";
import type { UiAssets } from "../src/server/assets.ts";

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

  it("reads the working tree against the base and writes nothing to the repository", async () => {
    write([...HEADER, ...WORKTREE]);
    const dir = join(root, REPO);
    const index = readFileSync(join(dir, ".git", "index"));
    const head = git(dir, ["rev-parse", "HEAD"]).trim();
    const lines = await blameFrom(dir, FILE, head, "worktree");
    expect(lines?.get(1)).toBe(6);
    // `cheapest`, below the five lines of `discount` and the five of the header.
    expect(lines?.get(14)).toBe(24);
    // What the header and `discount` added is nobody's in the base.
    expect([...(lines?.values() ?? [])]).not.toContain(1);
    expect(readFileSync(join(dir, ".git", "index")).equals(index)).toBe(true);
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

  it("is neither open nor resolved in the counters, nor unanswered", async () => {
    await orphan();
    const counters = countReview(await list(dataDir, session)).counters;
    expect(counters).toMatchObject({ total: 1, open: 0, resolved: 0, unanswered: 0 });
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

  it("is refused a reopen that names no line, and nothing is written", async () => {
    const added = await orphan();
    await expect(reopen(dataDir, session, added.id, HUMAN)).rejects.toMatchObject({
      code: "anchor-orphaned",
    });
    expect((await stored(added.id)).status).toBe("orphaned");
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

  it("lists orphaned comments by their status, and not among the open ones", async () => {
    const added = await orphan();
    const open = await commentOn(4);
    const orphaned = JSON.parse((await invoke(["list", "--status", "orphaned", "--json"])).out);
    expect(orphaned.map((one: Comment) => one.id)).toEqual([added.id]);
    const listed = JSON.parse((await invoke(["list", "--json"])).out);
    expect(listed.map((one: Comment) => one.id)).toEqual([open.id]);
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

  it("reopens an orphaned comment only with --line, and on that line", async () => {
    const added = await orphan();
    const refused = await invoke(["reopen", added.id, "--role", "human"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--line");
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

  it("re-anchors an edit a CLI command wrote into diff.json before the rescan came", async () => {
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
