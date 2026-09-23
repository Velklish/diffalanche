/**
 * The watcher of [ADR-005](../docs/adr/adr-005-live-update.md): an edit in one
 * repository reaches `diff.json` and the event bus inside the budget of
 * `docs/SPEC.md` section 6, and a write into the data directory from another
 * process becomes comment events.
 */
import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { scanReview } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { closeSession, createSession } from "../src/core/domain/index.ts";
import { checkIgnore } from "../src/core/git/index.ts";
import { scan } from "../src/core/index.ts";
import {
  commentsPath,
  diffCachePath,
  readComments,
  readDiffCache,
  readReview,
  updateComments,
  writeDiffCache,
  writeReview,
} from "../src/core/storage/index.ts";
import type { ScanResult } from "../src/core/types.ts";
import type {
  ActivityEvent,
  EventBus,
  TreeSource,
  Watcher,
  WatcherEvent,
  WatcherOptions,
} from "../src/core/watcher/index.ts";
import {
  createActivityLog,
  createEventBus,
  dataIgnore,
  dropsVerdicts,
  IGNORE_CACHE_LIMIT,
  probeRecursiveWatch,
  repositoryIgnore,
  rescanRepository,
  snapshotSessions,
  startWatcher,
  supportsRecursiveWatch,
  trimVerdicts,
  watchTree,
} from "../src/core/watcher/index.ts";

const run = promisify(execFile);
const appendReply = fileURLToPath(new URL("./helpers/append-reply.ts", import.meta.url));

const SESSION = "synth";
const REPO = "repos/core/cargos-api";
/** A second repository with changes, for the settle gate. */
let OTHER_REPO = "";
const OTHER = "repos/core/cargos-api-worktree";
/** `docs/SPEC.md` section 6: update after an edit in one repository. */
const BUDGET_MS = 300;
/** How many edits the budget is measured over. */
const RUNS = 3;

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;
}

/**
 * Bun's own test runner leaves `fs.watch` quiet after the first events — a real
 * server under Bun keeps reporting, which is what
 * `docs/reference/05-watcher.md` records — so the walk is what these tests
 * exercise there, and the recursive watch is exercised under Node.
 */
const NATIVE_WATCH = process.env.DIFFALANCHE_TEST_RUNTIME !== "bun";

let root: string;
let config: Config;
let found: ScanResult;
let watcher: Watcher;
let bus: EventBus;
const activity: ActivityEvent[] = [];
const failures: unknown[] = [];
const seen: { event: WatcherEvent; at: number }[] = [];

function since(mark: number, type: WatcherEvent["type"]): { event: WatcherEvent; at: number }[] {
  return seen.filter((one) => one.at >= mark && one.event.type === type);
}

/** The diff changes of one repository since a mark; the others are somebody else's. */
function changesOf(mark: number, repo: string): { event: WatcherEvent; at: number }[] {
  return since(mark, "diff-changed").filter((one) => (one.event as { repo: string }).repo === repo);
}

let settled = 0;

/**
 * Proves the watch of one repository is delivering before anything is measured
 * against it.
 *
 * `fs.watch` with `recursive: true` arms asynchronously: it returns before the
 * platform is delivering, and a write made in that window is **lost outright**
 * rather than delayed. Measured on this fixture — the watcher started and
 * stopped thirty times, a file written the moment `startWatcher` returned —
 * four writes of the thirty produced no event at all inside five seconds, while
 * the other twenty-six produced one in about 190 ms. That is what a
 * `no diff-changed within 20000 ms` here has always been: not a slow machine,
 * but a write nobody was listening for.
 *
 * The write is **repeated** rather than waited on for longer: what is being
 * waited out is a lost write, and no ceiling brings one back. It is done per
 * repository, because each tree is its own watch.
 *
 * **The probe file's removal is waited for by its own event, never by a sleep.**
 * Taking the file away changes the repository's change set back, so it produces
 * a `diff-changed` of its own, and that event is the only proof it has been
 * through the queue. A fixed pause here was wrong in the way this file already
 * warns about at `settle()`: a machine slow enough to deliver it late hands the
 * *next* test an event for the repository that was armed last. Measured on
 * `main` as one red run in six — the first test received `loads-search` where
 * it expected `cargos-api`, 21 ms in, which is an event arriving early for
 * somebody else rather than one arriving late.
 */
async function arm(repo: string): Promise<void> {
  const deadline = performance.now() + 30_000;
  for (let attempt = 0; ; attempt += 1) {
    const mark = performance.now();
    const file = join(root, repo, `armed-${attempt}.ts`);
    await writeFile(file, `export const armed = ${attempt};\n`);
    const until = performance.now() + 2_000;
    while (performance.now() < until) {
      if (changesOf(mark, repo).length > 0) {
        // The file goes again, and its removal is a change of its own: the
        // tests that follow start from a watcher with nothing in flight.
        const removed = performance.now();
        await rm(file, { force: true });
        await waitForChangeOf(repo, removed);
        return;
      }
      await new Promise((done) => setTimeout(done, 5));
    }
    if (performance.now() > deadline) throw new Error(`the watch of ${repo} never armed`);
  }
}

/**
 * A change in another repository, waited for. Rescans run in one queue, so the
 * event of a change made after another one proves the earlier one has been
 * through — which is what a test that expects *no* event needs, rather than a
 * sleep long enough to be wrong on a loaded machine.
 */
async function settle(): Promise<void> {
  settled += 1;
  const mark = performance.now();
  await writeFile(join(root, OTHER_REPO, `settle-${settled}.ts`), `export const s = ${settled};\n`);
  const deadline = performance.now() + 10_000;
  for (;;) {
    if (changesOf(mark, OTHER_REPO).length > 0) return;
    if (performance.now() > deadline) throw new Error("the watcher never caught up");
    await new Promise((done) => setTimeout(done, 5));
  }
}

/**
 * The rescan of the watched repository, waited for. `settle` only proves that a
 * change made in *another* repository has been through, which says nothing
 * about a write to this one that the walk has not snapshotted yet.
 */
async function waitForChangeOf(repo: string, mark: number, timeoutMs = 20_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (changesOf(mark, repo).length > 0) return;
    if (performance.now() > deadline) throw new Error(`no diff-changed for ${repo}`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/**
 * A change git sees and the watch does not: `node_modules` is out of the watch
 * and no rule of these tests names it, so it is in the change set the next
 * rescan of the repository reads. That is what makes "no rescan" visible at
 * all — an ignored file rescanned on its own finds the change set exactly as
 * the cache has it and announces nothing either way.
 */
async function hide(name: string, content: string): Promise<void> {
  mkdirSync(join(root, REPO, "node_modules", name), { recursive: true });
  await writeFile(join(root, REPO, "node_modules", name, "index.ts"), content);
}

/** Takes back what `hide` left, so the next test starts from the same tree. */
async function reveal(name: string): Promise<void> {
  await rm(join(root, REPO, "node_modules", name), { recursive: true, force: true });
}

/**
 * The first event of a type since a mark, **whichever repository it is about**.
 * `changesOf` is the filtered one; this is deliberately not, and the difference
 * is not an oversight to tidy up.
 *
 * A caller that expects an event of its own and receives another repository's
 * fails on the assertion that follows, naming both — which is exactly how the
 * cross-repository event `arm()` used to leave behind was found: `expected
 * 'repos/platform/loads-search' to be 'repos/core/cargos-api'`, 21 ms in. Given
 * a filter here, that event would have been skipped over in silence and the
 * test would have gone on to catch its own a moment later, green every time
 * while the watcher was handing out somebody else's news. **The lack of a
 * filter is what makes a stray event visible at all**, so anything that leaks
 * one is a defect to fix at the source rather than to hide here.
 */
async function waitFor(
  type: WatcherEvent["type"],
  mark: number,
  timeoutMs = 20_000,
): Promise<{ event: WatcherEvent; at: number }> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const hit = since(mark, type)[0];
    if (hit) return hit;
    if (performance.now() > deadline) throw new Error(`no ${type} within ${timeoutMs} ms`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/** What one rescan of the watched repository costs on this machine right now. */
async function baseline(): Promise<number> {
  const runs: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    await rescanRepository(config, SESSION, REPO);
    runs.push(performance.now() - started);
  }
  return median(runs);
}

/** The change set of every repository, as the server writes it before it starts watching. */
async function writeCache(): Promise<void> {
  const { cache } = await scanReview(config, { mode: "head" });
  await writeDiffCache(config.dataDir, SESSION, cache);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-watcher-"));
  generate({ out: root, seed: 5, profile: PROFILES.small });
  config = await loadConfig({ root });
  found = await scan(config.root, { roots: config.roots, depth: config.depth, exclude: [] });
  await writeCache();

  OTHER_REPO = found.repositories
    .map((repository) => repository.path)
    .find((path) => path !== REPO && !path.endsWith("-worktree")) as string;

  bus = createEventBus();
  bus.subscribe((event) => seen.push({ event, at: performance.now() }));
  const log = createActivityLog();
  watcher = await startWatcher({
    config,
    scan: found,
    ...(NATIVE_WATCH ? {} : { recursive: false, pollIntervalMs: 40 }),
    bus,
    activity: {
      wrote: (verb, author, repo, path) => {
        const event = log.wrote(verb, author, repo, path);
        activity.push(event);
        return event;
      },
      diffChanged: (repo) => {
        const event = log.diffChanged(repo);
        activity.push(event);
        return event;
      },
      recent: log.recent,
    },
    onError: (error) => {
      failures.push(error);
      // A reporter that throws must not take the rescan queue down with it.
      throw error;
    },
  });

  // Both trees the tests below write into, and before any of them measures.
  await arm(REPO);
  await arm(OTHER_REPO);
}, 120_000);

afterAll(async () => {
  // Awaited: a rescan still in flight would re-create the session directory
  // under a root this line is about to remove.
  await watcher?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("watcher", () => {
  it("rescans the edited repository alone and has the new hunk in diff.json in time", async () => {
    const elapsed: number[] = [];
    let first = 0;
    // Three edits and the median of them, the way the performance gate reads
    // its own numbers: one slow run on a busy machine is not a regression. Each
    // edit is its own file: a runtime that coalesces the changes of one file
    // into one event — macOS does, under Bun — would otherwise answer the
    // second edit with the event of the first.
    for (let run = 0; run < RUNS; run += 1) {
      const mark = performance.now();
      if (run === 0) first = mark;
      await writeFile(join(root, REPO, `watched-${run}.ts`), `export const watched = ${run};\n`);
      const hit = await waitFor("diff-changed", mark);
      elapsed.push(hit.at - mark);
      const event = hit.event as Extract<WatcherEvent, { type: "diff-changed" }>;
      expect(event.repo).toBe(REPO);
    }

    // The event comes before the file: `diff.json` is written a moment after
    // the update the person sees, so the cache is read until it has caught up.
    const last = `watched-${RUNS - 1}.ts`;
    const wanted = `export const watched = ${RUNS - 1};`;
    const deadline = performance.now() + 20_000;
    let lines: string[] | undefined;
    while (performance.now() < deadline) {
      const cache = await readDiffCache(config.dataDir, SESSION);
      const repository = cache?.repositories.find((one) => one.path === REPO);
      const added = repository?.files.find((one) => one.path === last);
      lines = added?.hunks[0]?.lines.map((line) => line.content);
      if (lines?.[0] === wanted) break;
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(lines).toEqual([wanted]);
    // No other repository was rescanned by these edits.
    expect(
      new Set(since(first, "diff-changed").map((one) => (one.event as { repo: string }).repo)),
    ).toEqual(new Set([REPO]));
    // The budget on top of one rescan — five git processes and a cache rewrite — timed in the same
    // conditions: the watcher's own share; the flat 300 ms is `bun run perf`'s (05-watcher.md).
    process.stderr.write(`update after an edit: ${median(elapsed).toFixed(1)} ms\n`);
    // Only where the tree is watched. On the walk the number is the interval
    // and the cost of the walk itself, which is why a platform without a
    // recursive watch cannot meet this budget at all.
    if (NATIVE_WATCH) expect(median(elapsed)).toBeLessThan(BUDGET_MS + (await baseline()));
  }, 30_000);

  // The two below read what the test above produced — its activity line and the
  // file it wrote — so one failure there is three here. That is a dependency
  // between tests and not three defects.
  it("leaves the diff change unattributed while no agent has written", () => {
    const lines = activity.filter((event) => event.repo === REPO);
    expect(lines.at(-1)).toMatchObject({ verb: "changed", author: null });
  }, 30_000);

  it("says nothing when the file comes back with the same bytes", async () => {
    const file = join(root, REPO, `watched-${RUNS - 1}.ts`);
    const content = await readFile(file, "utf8");
    const mark = performance.now();
    // A build output written again, or a save with nothing changed: the file is
    // new to the watch and the same to the review.
    await writeFile(file, content);
    await settle();
    expect(changesOf(mark, REPO)).toEqual([]);
  }, 30_000);

  it("reads the whole change set again when diff.json is gone", async () => {
    await rm(diffCachePath(config.dataDir, SESSION));
    const mark = performance.now();
    await writeFile(join(root, REPO, "again.ts"), "export const again = 1;\n");
    await waitFor("diff-changed", mark);
    // A cache holding only the repository that changed would be read as a
    // review of one repository. The file follows the event, so it is read until
    // it is there.
    const deadline = performance.now() + 20_000;
    let repositories = 0;
    while (performance.now() < deadline) {
      repositories = (await readDiffCache(config.dataDir, SESSION))?.repositories.length ?? 0;
      if (repositories === PROFILES.small.repos) break;
      await new Promise((done) => setTimeout(done, 10));
    }
    expect(repositories).toBe(PROFILES.small.repos);
  }, 30_000);

  it("says nothing about a change inside .git/objects", async () => {
    const dir = join(root, REPO, ".git", "objects", "ff");
    mkdirSync(dir, { recursive: true });
    const mark = performance.now();
    writeFileSync(join(dir, "0123456789abcdef"), "not an object");
    await settle();
    expect(changesOf(mark, REPO)).toEqual([]);
  }, 30_000);

  it("says nothing about a burst git ignores, and wakes when the rules stop ignoring it", async () => {
    const gitignore = join(root, REPO, ".gitignore");
    const built = join(root, REPO, "dist", "bundle.js");
    mkdirSync(join(root, REPO, "dist"), { recursive: true });
    // The rules are a change of their own: they decide which untracked files
    // the change set has, so this write wakes the watcher, and the burst that
    // follows must not be the one carrying it.
    const rulesMark = performance.now();
    await writeFile(gitignore, "dist/\n");
    await waitForChangeOf(REPO, rulesMark);
    await settle();

    await hide("left-pad", "module.exports = 1;\n");

    const ignoredMark = performance.now();
    await writeFile(built, "console.log(1);\n");
    await settle();
    expect(changesOf(ignoredMark, REPO)).toEqual([]);

    // The same path once `.gitignore` no longer names it: the write to the
    // rules drops what was cached, so git is asked about it again.
    const relaxedMark = performance.now();
    await writeFile(gitignore, "nothing-here/\n");
    await waitForChangeOf(REPO, relaxedMark);
    await settle();

    const watchedMark = performance.now();
    await writeFile(built, "console.log(2);\n");
    await waitForChangeOf(REPO, watchedMark);
    expect(
      changesOf(watchedMark, REPO).flatMap((one) => (one.event as { files: string[] }).files),
    ).toContain("dist/bundle.js");

    await reveal("left-pad");
    await rm(join(root, REPO, "dist"), { recursive: true, force: true });
    const cleanMark = performance.now();
    await rm(gitignore);
    await waitForChangeOf(REPO, cleanMark);
    await settle();
  }, 60_000);

  it("says nothing about a path .git/info/exclude names", async () => {
    mkdirSync(join(root, REPO, ".git", "info"), { recursive: true });
    mkdirSync(join(root, REPO, "coverage"), { recursive: true });
    // Writing the rules is a change, and this one has to be through before the
    // burst under test: a hidden change gives its rescan something to announce,
    // so there is an event to wait for rather than a `settle` to hope on.
    await hide("right-pad-rules", "module.exports = 2;\n");
    const rulesMark = performance.now();
    await writeFile(join(root, REPO, ".git", "info", "exclude"), "coverage/\n");
    await waitForChangeOf(REPO, rulesMark);
    await settle();

    await hide("right-pad", "module.exports = 3;\n");

    const mark = performance.now();
    await writeFile(join(root, REPO, "coverage", "lcov.info"), "TN:\n");
    await settle();
    expect(changesOf(mark, REPO)).toEqual([]);

    await reveal("right-pad");
    await reveal("right-pad-rules");
    await rm(join(root, REPO, "coverage"), { recursive: true, force: true });
    await writeFile(join(root, REPO, ".git", "info", "exclude"), "");
    await settle();
  }, 30_000);

  it("has no answer where git has none", async () => {
    // Not a repository, so git refuses. The answer is `null` rather than an
    // empty set: an empty set would be cached as "none of these is ignored",
    // and a failure must leave nothing behind.
    const outside = mkdtempSync(join(tmpdir(), "diffalanche-not-a-repo-"));
    try {
      expect(await checkIgnore(outside, ["dist/bundle.js"])).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  }, 30_000);

  it("asks git again once the index has moved", async () => {
    const gitignore = join(root, REPO, ".gitignore");
    const built = join(root, REPO, "dist", "tracked.js");
    mkdirSync(join(root, REPO, "dist"), { recursive: true });
    await writeFile(built, "console.log(1);\n");
    const rulesMark = performance.now();
    await writeFile(gitignore, "dist/\n");
    await waitForChangeOf(REPO, rulesMark);
    await settle();

    // The verdict is cached now: this write is answered from it, not from git.
    await writeFile(built, "console.log(2);\n");
    await settle();

    // `git add -f` makes it tracked, and a tracked file is in the diff whatever
    // a pattern says. The index moving is what tells the watcher to ask again,
    // and it has to be its own burst: coalesced with the edit below, the edit
    // would ride on the rescan the index earned rather than on a fresh answer.
    const stagedMark = performance.now();
    await run("git", ["-C", join(root, REPO), "add", "-f", "dist/tracked.js"]);
    await waitForChangeOf(REPO, stagedMark);
    await settle();

    const trackedMark = performance.now();
    await writeFile(built, "console.log(3);\n");
    await waitForChangeOf(REPO, trackedMark);
    expect(
      changesOf(trackedMark, REPO).flatMap((one) => (one.event as { files: string[] }).files),
    ).toContain("dist/tracked.js");

    await run("git", ["-C", join(root, REPO), "rm", "--cached", "-q", "-f", "dist/tracked.js"]);
    await rm(join(root, REPO, "dist"), { recursive: true, force: true });
    const cleanMark = performance.now();
    await rm(gitignore);
    await waitForChangeOf(REPO, cleanMark);
    await settle();
  }, 60_000);

  it("wakes for a burst inside .git whatever the rules say about it", async () => {
    const gitignore = join(root, REPO, ".gitignore");
    const head = join(root, REPO, ".git", "HEAD");
    // git makes no exception for its own directory: this pattern has it answer
    // that `.git/HEAD` is ignored. A burst that is only a branch switch would
    // then be swallowed and the base of the review go stale in silence.
    const rulesMark = performance.now();
    await writeFile(gitignore, "HEAD\n");
    await waitForChangeOf(REPO, rulesMark);
    await settle();

    await hide("head-pad", "export const pad = 1;\n");

    const headMark = performance.now();
    // The same bytes: what moves is the file's stamp, the way a branch switch
    // moves it, and no reviewed repository is changed by it.
    await writeFile(head, await readFile(head, "utf8"));
    await waitForChangeOf(REPO, headMark);
    // The name a runtime reports for it is its own — Bun hands back the bare
    // `.git` where Node names the file — so what is asserted is that the burst
    // was git's directory and nothing else.
    const woke = changesOf(headMark, REPO).flatMap(
      (one) => (one.event as { files: string[] }).files,
    );
    expect(woke.length).toBeGreaterThan(0);
    expect(woke.every((path) => path === ".git" || path.startsWith(".git/"))).toBe(true);

    await reveal("head-pad");
    const cleanMark = performance.now();
    await rm(gitignore);
    await waitForChangeOf(REPO, cleanMark);
    await settle();
  }, 60_000);

  it("wakes for a burst from a nested repository's git directory, and not for its objects", async () => {
    const gitignore = join(root, REPO, ".gitignore");
    const nested = join(root, REPO, "nested", "clone", ".git");
    mkdirSync(join(nested, "objects", "ff"), { recursive: true });
    writeFileSync(join(nested, "HEAD"), "ref: refs/heads/main\n");
    // `nested/` is what makes this a check rather than a coincidence: git
    // answers that everything under it is ignored, this burst included. The
    // fixture's own `vendor/lib` is a modern submodule and was never affected.
    const rulesMark = performance.now();
    await writeFile(gitignore, "nested/\n");
    await waitForChangeOf(REPO, rulesMark);
    await settle();

    await hide("nested-pad", "module.exports = 1;\n");

    const headMark = performance.now();
    writeFileSync(join(nested, "HEAD"), "ref: refs/heads/other\n");
    await waitForChangeOf(REPO, headMark);
    // Bun hands back the directory where Node names the file, so what is
    // asserted is that the burst was the nested git directory and nothing else.
    const woke = changesOf(headMark, REPO).flatMap(
      (one) => (one.event as { files: string[] }).files,
    );
    expect(woke.length).toBeGreaterThan(0);
    expect(woke.every((path) => path.startsWith("nested/clone/.git"))).toBe(true);

    await reveal("nested-pad");
    await settle();

    // Its object store is the other half: pruned before any of that, so a
    // rescan with something to announce still announces nothing.
    await hide("nested-pad-objects", "module.exports = 2;\n");
    const objectsMark = performance.now();
    writeFileSync(join(nested, "objects", "ff", "0123456789abcdef"), "not an object");
    await settle();
    expect(changesOf(objectsMark, REPO)).toEqual([]);

    await reveal("nested-pad-objects");
    await rm(join(root, REPO, "nested"), { recursive: true, force: true });
    const cleanMark = performance.now();
    await rm(gitignore);
    await waitForChangeOf(REPO, cleanMark);
    await settle();
  }, 60_000);

  it("reports every ignored path of a list", async () => {
    await writeFile(join(root, REPO, ".git", "info", "exclude"), "target/\n");
    await settle();

    const paths = Array.from({ length: 50 }, (_, one) => `target/chunk-${one}.js`);
    const started = performance.now();
    const ignored = await checkIgnore(join(root, REPO), paths);
    const elapsed = performance.now() - started;
    // Measured once, not gated: one process for every path of the window, against the five a
    // rescan spends on one repository.
    process.stderr.write(
      `check-ignore over ${paths.length} paths: ${elapsed.toFixed(1)} ms in one process\n`,
    );
    expect(ignored?.size).toBe(paths.length);

    // A burst larger than the pipe between the two processes: the list is
    // written to standard input, and a failure there is not allowed to become
    // an uncaught exception in a server.
    const many = Array.from({ length: 5_000 }, (_, one) => `target/many-${one}.js`);
    expect((await checkIgnore(join(root, REPO), many))?.size).toBe(many.length);

    await writeFile(join(root, REPO, ".git", "info", "exclude"), "");
    await settle();
  }, 30_000);

  it("turns a reply written by another process into an event with its author", async () => {
    const comments = await readComments(config.dataDir, SESSION);
    const target =
      comments.find((one) => one.repo === REPO) ?? (comments[0] as (typeof comments)[0]);
    const mark = performance.now();
    await run(process.execPath, [appendReply, config.dataDir, SESSION, target.id, "claude"]);

    const hit = await waitFor("reply-added", mark);
    const event = hit.event as Extract<WatcherEvent, { type: "reply-added" }>;
    expect(event.commentId).toBe(target.id);
    expect(event.id).toBe(`r_${target.replies.length + 1}`);
    const replied = activity.filter((one) => one.verb === "replied").at(-1);
    expect(replied?.author).toBe("claude");
    expect(replied?.repo).toBe(target.repo);
  }, 30_000);

  it("names the agent that wrote recently as the one editing the repository", async () => {
    // The reply above was written by `claude` in this repository, so the diff
    // changes that follow are attributed to that agent for two minutes.
    const mark = performance.now();
    await writeFile(join(root, REPO, "edited.ts"), "export const edited = true;\n");
    await waitFor("diff-changed", mark);
    expect(activity.filter((event) => event.repo === REPO).at(-1)).toMatchObject({
      verb: "editing",
      author: "claude",
    });
  }, 30_000);

  it("reports a comment that changed status", async () => {
    const comments = await readComments(config.dataDir, SESSION);
    const target = comments[0] as (typeof comments)[0];
    const mark = performance.now();
    await updateComments(config.dataDir, SESSION, (list) => {
      const one = list.find((each) => each.id === target.id);
      if (one) one.status = one.status === "open" ? "resolved" : "open";
    });
    const hit = await waitFor("comment-status", mark);
    expect((hit.event as { id: string }).id).toBe(target.id);
    // Every write bumps `updatedAt` in `review.json`; that is not a session change.
    expect(since(mark, "session-changed")).toEqual([]);
  }, 30_000);

  it("follows the current session when the pointer changes", async () => {
    const mark = performance.now();
    await writeFile(join(config.dataDir, "current"), `${SESSION}-other\n`);
    // The pointer moved, which is not a change to what any session *is*: a
    // window on a task of its own must not re-read on somebody else's switch.
    await new Promise((done) => setTimeout(done, 4 * BUDGET_MS));
    expect(watcher.session()).toBe(`${SESSION}-other`);
    expect(
      since(mark, "current-changed").map((one) => (one.event as { name: string }).name),
    ).toEqual([`${SESSION}-other`]);
    expect(since(mark, "session-changed")).toEqual([]);
    await writeFile(join(config.dataDir, "current"), `${SESSION}\n`);
    await waitFor("current-changed", performance.now() - 1);
  }, 30_000);

  it("announces a task that appeared and a task whose status changed", async () => {
    // A task an agent opens does not become the current session (DA-53), so
    // this is the only word an open window gets about it.
    const appeared = performance.now();
    await createSession(config.dataDir, "a-new-task", { mode: "head" }, "opened by an agent", {
      use: false,
    });
    const created = await waitFor("sessions-changed", appeared);
    expect(created.event).toMatchObject({ name: "a-new-task", status: "open" });
    expect(watcher.session()).toBe(SESSION);

    const closed = performance.now();
    await closeSession(config.dataDir, "a-new-task", { author: "kim.p", role: "human" });
    const marked = await waitFor("sessions-changed", closed);
    expect(marked.event).toMatchObject({ name: "a-new-task", status: "closed" });
  }, 30_000);
});

describe("a rescan that fails", () => {
  it("is reported, dropped, and does not stop the next one", async () => {
    const pointer = join(config.dataDir, "current");
    const file = join(root, REPO, "broken.ts");
    const before = failures.length;

    const switched = performance.now();
    await writeFile(pointer, "ghost\n");
    // The pointer has to be read before the edit, or the rescan still finds
    // the session that was current when it was scheduled.
    await waitFor("current-changed", switched);
    const failed = performance.now();
    await writeFile(file, "export const broken = 1;\n");
    // The session named by the pointer is not there, so the rescan refuses;
    // the refusal itself is the gate rather than a length of time.
    const deadline = performance.now() + 10_000;
    while (failures.length === before && performance.now() < deadline) {
      await new Promise((done) => setTimeout(done, 5));
    }
    expect(failures.length).toBeGreaterThan(before);
    expect(since(failed, "diff-changed")).toEqual([]);

    await writeFile(pointer, `${SESSION}\n`);
    await waitFor("current-changed", performance.now() - 1);
    const mark = performance.now();
    await writeFile(file, "export const broken = 2;\n");
    const hit = await waitFor("diff-changed", mark);
    expect((hit.event as { repo: string }).repo).toBe(REPO);
  }, 30_000);
});

describe("the snapshot the session events are read from", () => {
  it("keeps what it knew when `reviews/` cannot be listed, and does not empty it", async () => {
    const reviews = join(config.dataDir, "reviews");
    const first = await snapshotSessions(config, null);
    expect(first?.get(SESSION)).toBe("open");

    chmodSync(reviews, 0o000);
    try {
      // A failed listing is not an empty data directory. Answering with one
      // would make every session news again on the next readable pass, and a
      // few hundred of those would push the replay out of the stream's ring.
      expect(await snapshotSessions(config, first)).toBeNull();
    } finally {
      chmodSync(reviews, 0o755);
    }

    // A session whose own file cannot be read keeps the status it had: a file
    // caught mid-write is not a task that changed.
    const broken = join(reviews, SESSION, "review.json");
    const kept = readFileSync(broken, "utf8");
    writeFileSync(broken, "{ not json");
    try {
      expect((await snapshotSessions(config, first))?.get(SESSION)).toBe("open");
      expect((await snapshotSessions(config, null))?.has(SESSION)).toBe(false);
    } finally {
      writeFileSync(broken, kept);
    }
  }, 30_000);
});

describe("what a repository's watch reports", () => {
  it("keeps the three files of .git that decide the change set and drops the rest", () => {
    const ignore = repositoryIgnore(config, {
      path: REPO,
      absolutePath: join(root, REPO),
      kind: "repo",
    });
    expect(ignore(".git/HEAD", "file")).toBe(false);
    expect(ignore(".git/index", "file")).toBe(false);
    // The ignore rules of the repository: they decide which untracked files the
    // change set has, and the walk has to be let into `.git/info` to see them.
    expect(ignore(".git/info/exclude", "file")).toBe(false);
    expect(ignore(".git/info", "dir")).toBe(false);
    expect(ignore(".git/info/attributes", "file")).toBe(true);
    expect(ignore(".git/objects/ff/0123", "file")).toBe(true);
    expect(ignore(".git/objects", "dir")).toBe(true);
    expect(ignore(".git", "dir")).toBe(false);
    // A runtime that reports the directory rather than the file inside it
    // would otherwise never say that HEAD moved.
    expect(ignore(".git", "file")).toBe(false);
    expect(ignore("src/a.ts", "file")).toBe(false);
    expect(ignore("node_modules/left-pad/index.js", "file")).toBe(true);
  }, 30_000);

  it("drops the kept verdicts when a burst names git's directory in any shape", () => {
    // A build's `dist/out.js` was asked about once and answered `true`; the
    // burst that follows is the `git add -f` that makes it tracked.
    const collapsed = new Map<string, boolean>([["dist/out.js", true]]);
    // Bun hands back the bare `.git` where Node names `.git/index`, and a kept
    // `true` would suppress every later edit of the now-tracked file.
    expect(dropsVerdicts([".git"], collapsed)).toBe(true);
    expect(collapsed.has("dist/out.js")).toBe(false);

    const named = new Map<string, boolean>([["dist/out.js", true]]);
    expect(dropsVerdicts([".git/index"], named)).toBe(true);
    expect(named.size).toBe(0);

    // The rules themselves, at the root of the repository and below it.
    expect(dropsVerdicts([".gitignore"], new Map([["dist/out.js", true]]))).toBe(true);
    expect(dropsVerdicts(["src/.gitignore"], new Map([["dist/out.js", true]]))).toBe(true);
    expect(dropsVerdicts([".git/info/exclude"], new Map([["dist/out.js", true]]))).toBe(true);

    // An ordinary burst leaves what git already answered where it is.
    const answered = new Map<string, boolean>([["dist/out.js", true]]);
    expect(dropsVerdicts(["dist/out.js"], answered)).toBe(false);
    expect(answered.get("dist/out.js")).toBe(true);
  }, 30_000);

  it("shows a nested repository's gitlink and none of its bookkeeping", () => {
    const ignore = repositoryIgnore(config, {
      path: REPO,
      absolutePath: join(root, REPO),
      kind: "repo",
    });
    // Where the gitlink points: `HEAD` moves on a checkout, the branch ref on a
    // commit, and the outer diff moves with them.
    expect(ignore("vendor/lib/.git/HEAD", "file")).toBe(false);
    expect(ignore("vendor/lib/.git/packed-refs", "file")).toBe(false);
    expect(ignore("vendor/lib/.git/refs/heads/main", "file")).toBe(false);
    expect(ignore("vendor/lib/.git/refs/heads/feature/x", "file")).toBe(false);
    expect(ignore("vendor/lib/.git/refs", "dir")).toBe(false);
    expect(ignore("vendor/lib/.git/refs/heads", "dir")).toBe(false);
    expect(ignore("vendor/lib/.git/refs/heads/feature", "dir")).toBe(false);
    // The directory itself, for the runtime that reports only that.
    expect(ignore("vendor/lib/.git", "dir")).toBe(false);
    expect(ignore("vendor/lib/.git", "file")).toBe(false);

    // Its bookkeeping is the outer repository's business in no way at all: a
    // fetch writes every one of these and cannot move the outer change set.
    expect(ignore("vendor/lib/.git/objects", "dir")).toBe(true);
    expect(ignore("vendor/lib/.git/objects/ff/0123", "file")).toBe(true);
    expect(ignore("vendor/lib/.git/logs", "dir")).toBe(true);
    expect(ignore("vendor/lib/.git/logs/HEAD", "file")).toBe(true);
    expect(ignore("vendor/lib/.git/refs/remotes", "dir")).toBe(true);
    expect(ignore("vendor/lib/.git/refs/remotes/origin/main", "file")).toBe(true);
    expect(ignore("vendor/lib/.git/modules", "dir")).toBe(true);
    expect(ignore("vendor/lib/.git/FETCH_HEAD", "file")).toBe(true);
    expect(ignore("vendor/lib/.git/index", "file")).toBe(true);
    expect(ignore("vendor/lib/.git/config", "file")).toBe(true);

    // The working tree of the nested repository is not git's directory.
    expect(ignore("vendor/lib/src/a.ts", "file")).toBe(false);
    // And the repository's own `.git` keeps exactly the rules it had.
    expect(ignore(".git/HEAD", "file")).toBe(false);
    expect(ignore(".git/index", "file")).toBe(false);
    expect(ignore(".git/info/exclude", "file")).toBe(false);
    expect(ignore(".git/objects/ff/0123", "file")).toBe(true);
  }, 30_000);

  it("keeps the ignore verdicts of a repository inside their cap, oldest out first", () => {
    // A build writing thousands of distinct paths would otherwise grow the
    // cache for as long as the server runs.
    const cache = new Map<string, boolean>();
    for (let one = 0; one < IGNORE_CACHE_LIMIT + 500; one += 1) {
      cache.set(`dist/chunk-${one}.js`, true);
    }
    trimVerdicts(cache);

    expect(cache.size).toBe(IGNORE_CACHE_LIMIT);
    // What went is what was asked longest ago; what was asked last is still there.
    expect(cache.has("dist/chunk-0.js")).toBe(false);
    expect(cache.has("dist/chunk-499.js")).toBe(false);
    expect(cache.has("dist/chunk-500.js")).toBe(true);
    expect(cache.has(`dist/chunk-${IGNORE_CACHE_LIMIT + 499}.js`)).toBe(true);
  }, 30_000);

  it("takes every name a write in the data directory can be reported under", () => {
    // macOS coalesces the changes of one directory and a runtime reports any of
    // the names involved: the file, the temporary file renamed over it, the
    // lock the write took, or the directory itself. All of them are the signal.
    expect(dataIgnore("reviews/synth/comments.json", "file")).toBe(false);
    expect(dataIgnore("reviews/synth/comments.json.tmp-9e7c", "file")).toBe(false);
    expect(dataIgnore("reviews/synth/.lock/info.json", "file")).toBe(false);
    expect(dataIgnore("reviews", "file")).toBe(false);
    expect(dataIgnore("current", "file")).toBe(false);
    // Except the one file the watcher writes itself.
    expect(dataIgnore("reviews/synth/diff.json", "file")).toBe(true);
    expect(dataIgnore("reviews/synth/diff.json.tmp-4b1a", "file")).toBe(true);
  });

  it("drops the exclude globs of the configuration and the data directory", () => {
    const ignore = repositoryIgnore(
      { ...config, exclude: ["**/*.lock"] },
      { path: ".", absolutePath: root, kind: "repo" },
    );
    expect(ignore("src/bun.lock", "file")).toBe(true);
    expect(ignore("src/a.ts", "file")).toBe(false);
    // The root is a repository here, so the tool's own writes are inside it.
    expect(ignore(".diffalanche/reviews/synth/diff.json", "file")).toBe(true);
  }, 30_000);
});

describe("watching a tree", () => {
  it("finds that this runtime's recursive watch really recurses", async () => {
    // Node from 20.13 and Bun from 1.1 recurse on macOS, Linux, and Windows; a
    // runtime that does not is what the probe exists to catch.
    expect(await supportsRecursiveWatch(config.dataDir)).toBe(true);
  }, 30_000);

  it("answers instead of throwing when the probe's first write fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-probe-"));
    try {
      // A disk that fills between `mkdir` and the write: detached from the
      // promise the probe awaits, this rejection ends the process.
      const answer = await probeRecursiveWatch(dir, () => Promise.reject(new Error("ENOSPC")));
      expect(answer).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("takes its baseline before it says it is watching", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-baseline-"));
    // Enough files that the first walk takes longer than the write after it:
    // a change made while the baseline is being taken would be part of it.
    for (let index = 0; index < 2_000; index += 1) {
      writeFileSync(join(dir, `f${index}.ts`), `export const f = ${index};\n`);
    }
    const seen: string[] = [];
    const walking = watchTree({
      dir,
      ignore: () => false,
      onChange: (path) => seen.push(path),
      recursive: false,
      pollIntervalMs: 20,
    });
    try {
      await walking.ready;
      writeFileSync(join(dir, "after.ts"), "export const after = 1;\n");
      const deadline = performance.now() + 20_000;
      while (!seen.includes("after.ts") && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(seen).toContain("after.ts");
    } finally {
      walking.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("says the walk took over once its baseline is taken, and reports nothing from it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-fallback-"));
    const seen: string[] = [];
    let fail = (): void => undefined;
    let tookOver = 0;
    const walking = watchTree({
      dir,
      ignore: () => false,
      onChange: (path) => seen.push(path),
      onFallback: () => {
        tookOver += 1;
      },
      pollIntervalMs: 20,
      // What inotify running out of watches leaves behind, driven rather than
      // waited for: the watch is alive until the test makes it fail.
      native: (_options, onFailure) => {
        fail = onFailure;
        return { polling: false, ready: Promise.resolve(), close: () => undefined };
      },
    });
    try {
      const first = walking.ready;
      await first;
      expect(walking.polling()).toBe(false);

      // Written while the watch is dying: the walk's baseline absorbs it, which
      // is why the takeover is announced whole instead of name by name.
      writeFileSync(join(dir, "during.ts"), "export const during = 1;\n");
      fail();
      expect(walking.polling()).toBe(true);
      // The live `ready` is the replacement's, not the dead watch's.
      expect(walking.ready).not.toBe(first);

      const deadline = performance.now() + 20_000;
      while (tookOver === 0 && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(tookOver).toBe(1);
      expect(seen).toEqual([]);

      // And the tree is covered again by the time the takeover was announced.
      writeFileSync(join(dir, "after.ts"), "export const after = 1;\n");
      while (!seen.includes("after.ts") && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(seen).toEqual(["after.ts"]);
    } finally {
      walking.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not walk into a nested repository's git directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-nested-"));
    const nested = join(dir, "vendor", "lib", ".git");
    mkdirSync(join(nested, "objects", "ff"), { recursive: true });
    mkdirSync(join(dir, "vendor", "lib", "src"), { recursive: true });
    writeFileSync(join(nested, "objects", "ff", "0123"), "an object");
    const seen: string[] = [];
    const walking = watchTree({
      dir,
      ignore: repositoryIgnore(config, { path: ".", absolutePath: dir, kind: "repo" }),
      onChange: (path) => seen.push(path),
      recursive: false,
      pollIntervalMs: 20,
    });
    try {
      await walking.ready;
      // The walk is where this costs continuously: every loose object and pack
      // of the nested repository, stat'd on every tick.
      writeFileSync(join(nested, "objects", "ff", "4567"), "another object");
      writeFileSync(join(nested, "FETCH_HEAD"), "fetched\n");
      writeFileSync(join(dir, "vendor", "lib", "src", "a.ts"), "export const a = 1;\n");
      const deadline = performance.now() + 20_000;
      while (!seen.includes("vendor/lib/src/a.ts") && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(seen).toEqual(["vendor/lib/src/a.ts"]);

      // The gitlink itself is not bookkeeping: a commit in there moves the
      // outer diff, and the branch ref is what moves with it.
      mkdirSync(join(nested, "refs", "heads"), { recursive: true });
      writeFileSync(join(nested, "refs", "heads", "main"), "0123456789abcdef\n");
      while (!seen.includes("vendor/lib/.git/refs/heads/main") && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(seen).toContain("vendor/lib/.git/refs/heads/main");
    } finally {
      walking.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("walks the tree when the recursive watch is not used", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-walk-"));
    mkdirSync(join(dir, "sub"));
    const seen: string[] = [];
    const walking = watchTree({
      dir,
      ignore: () => false,
      onChange: (path) => seen.push(path),
      recursive: false,
      pollIntervalMs: 20,
    });
    try {
      expect(walking.polling()).toBe(true);
      await new Promise((done) => setTimeout(done, 60));
      writeFileSync(join(dir, "sub", "a.txt"), "one");
      const deadline = performance.now() + 2_000;
      while (!seen.includes("sub/a.txt") && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(seen).toContain("sub/a.txt");
    } finally {
      walking.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("a comments.json that cannot be read", () => {
  /** Renames the current session, which is a change of what the review is. */
  async function rename(title: string): Promise<void> {
    const review = await readReview(config.dataDir, SESSION);
    await writeReview(config.dataDir, SESSION, { ...review, title });
  }

  it("stops the comment events and leaves the rest of the chain running", async () => {
    const path = commentsPath(config.dataDir, SESSION);
    const kept = readFileSync(path, "utf8");
    const task = "a-broken-comments-task";
    try {
      // Invalid JSON first, then a version this build refuses whole: the two
      // shapes `readComments` throws on.
      for (const broken of ["{ not json", `{ "version": 99, "comments": [] }\n`]) {
        const before = failures.length;
        const brokeAt = performance.now();
        writeFileSync(path, broken);
        await rename(`broken at ${brokeAt}`);
        await waitFor("session-changed", brokeAt);

        const listed = performance.now();
        if (broken === "{ not json") {
          await createSession(config.dataDir, task, { mode: "head" }, "opened while broken", {
            use: false,
          });
        } else {
          await closeSession(config.dataDir, task, { author: "kim.p", role: "human" });
        }
        await waitFor("sessions-changed", listed);
        // Reported once on the way into the broken state, not once per burst.
        expect(failures.length).toBe(before + 1);

        // Repaired: what is in the file is the baseline, not two hundred
        // comments that were all just added.
        const repaired = performance.now();
        writeFileSync(path, kept);
        await rename(`repaired at ${repaired}`);
        await waitFor("session-changed", repaired);
        await settle();
        expect(since(repaired, "comment-added")).toEqual([]);
      }
    } finally {
      writeFileSync(path, kept);
    }
  }, 60_000);

  it("is a transition when the pointer moves onto it, and says so once", async () => {
    const task = "a-task-with-broken-comments";
    await createSession(config.dataDir, task, { mode: "head" }, "broken from the start", {
      use: false,
    });
    writeFileSync(commentsPath(config.dataDir, task), "{ not json");
    const before = failures.length;
    const switched = performance.now();
    try {
      await writeFile(join(config.dataDir, "current"), `${task}\n`);
      await waitFor("current-changed", switched);
      // The baseline of the session switched to is read like any other, so a
      // file that cannot be read there is the same transition as a broken write.
      expect(failures.length).toBe(before + 1);
    } finally {
      await writeFile(join(config.dataDir, "current"), `${SESSION}\n`);
      await waitFor("current-changed", performance.now() - 1);
    }
  }, 60_000);
});

describe("a watcher whose watches die under it", () => {
  it("rescans the repository the walk took over, and says the runtime gave up once", async () => {
    const failures = new Map<string, () => void>();
    const seenHere: WatcherEvent[] = [];
    const own = createEventBus();
    own.subscribe((event) => seenHere.push(event));
    let fellBack = 0;
    // Its own data directory, or the two watchers race for one `diff.json`:
    // whichever writes first leaves the other's `sameChange` with nothing to say.
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-takeover-"));
    mkdirSync(join(dataDir, "reviews", SESSION), { recursive: true });
    for (const name of ["review.json", "comments.json", "diff.json"]) {
      const from = join(config.dataDir, "reviews", SESSION, name);
      if (existsSync(from)) copyFileSync(from, join(dataDir, "reviews", SESSION, name));
    }
    // Written rather than copied: the suite's pointer is moved by other tests,
    // and the session this watcher works on has to be the one meant here.
    writeFileSync(join(dataDir, "current"), `${SESSION}\n`);
    // Its own bus and its own trees: the suite's watcher stays where it is, and
    // the injected watch delivers nothing, so only the takeover can speak here.
    const taken = await startWatcher({
      config: { ...config, dataDir },
      scan: found,
      bus: own,
      activity: createActivityLog(),
      pollIntervalMs: 40,
      onFallback: () => {
        fellBack += 1;
      },
      native: (options, onFailure) => {
        failures.set(options.dir, onFailure);
        return { polling: false, ready: Promise.resolve(), close: () => undefined };
      },
    });
    const file = join(root, REPO, "took-over.ts");
    const other = join(root, OTHER_REPO, "took-over.ts");
    const changedIn = (repo: string): boolean =>
      seenHere.some((event) => event.type === "diff-changed" && event.repo === repo);
    const until = async (repo: string): Promise<void> => {
      const deadline = performance.now() + 20_000;
      while (!changedIn(repo) && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 5));
      }
    };
    try {
      // Written while the watch is dying: no name for it is ever delivered, so
      // the rescan of the whole repository is the only thing that can find it.
      await writeFile(file, "export const tookOver = 1;\n");
      (failures.get(join(root, REPO)) as () => void)();
      await until(REPO);
      expect(changedIn(REPO)).toBe(true);
      expect(fellBack).toBe(1);

      // A second tree going the same way is the same runtime giving up, so the
      // rescan arrives again and the word about it does not.
      await writeFile(other, "export const tookOver = 2;\n");
      (failures.get(join(root, OTHER_REPO)) as () => void)();
      await until(OTHER_REPO);
      expect(changedIn(OTHER_REPO)).toBe(true);
      expect(fellBack).toBe(1);
    } finally {
      await taken.close();
      rmSync(dataDir, { recursive: true, force: true });
      await rm(file, { force: true });
      await rm(other, { force: true });
      await settle();
    }
  }, 60_000);
});

describe("a watcher that walks from the start", () => {
  let dataDir: string;
  let walks: number;
  let fallbacks: number;
  let changed: string[];

  /** A watch that is alive and delivers nothing until the test fails it. */
  const alive = (): TreeSource => ({ polling: false, ready: Promise.resolve(), close: () => {} });

  // Its own data directory: nothing here needs a session, and the suite's stays untouched.
  function start(recursive: boolean, native: WatcherOptions["native"]): Promise<Watcher> {
    return startWatcher({
      config: { ...config, dataDir },
      scan: found,
      bus: createEventBus(),
      activity: createActivityLog(),
      pollIntervalMs: 40,
      recursive,
      onWalk: () => {
        walks += 1;
      },
      onFallback: () => {
        fallbacks += 1;
      },
      onRepositoryChanged: (repo) => changed.push(repo),
      ...(native === undefined ? {} : { native }),
    });
  }

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "diffalanche-walk-"));
    mkdirSync(join(dataDir, "reviews"), { recursive: true });
    walks = 0;
    fallbacks = 0;
    changed = [];
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("says so once when the runtime refuses the watch, and nothing when the walk was asked for", async () => {
    // What Node's ERR_FEATURE_UNAVAILABLE_ON_PLATFORM leaves: `watch` refused when it is built.
    await (await start(true, () => null)).close();
    expect(walks).toBe(1);
    await (await start(false, () => null)).close();
    expect(walks).toBe(1);
    expect(fallbacks).toBe(0);
  }, 60_000);

  it("says nothing when every watch it built is working", async () => {
    await (await start(true, alive)).close();
    expect(walks).toBe(0);
  }, 60_000);

  it("does not say the takeover line after it, when a watch that did start dies later", async () => {
    const failures = new Map<string, () => void>();
    const watcher = await start(true, (options, onFailure) => {
      // One tree refused at construction, the way `watch` refuses on ENOENT or EMFILE.
      if (options.dir === join(root, REPO)) return null;
      failures.set(options.dir, onFailure);
      return alive();
    });
    try {
      expect(walks).toBe(1);
      (failures.get(join(root, OTHER_REPO)) as () => void)();
      // The takeover's rescan comes after its report, so by then the line was said or not.
      const deadline = performance.now() + 20_000;
      while (!changed.includes(OTHER_REPO) && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(changed).toContain(OTHER_REPO);
      expect(walks).toBe(1);
      expect(fallbacks).toBe(0);
    } finally {
      await watcher.close();
    }
  }, 60_000);
});

describe("the repository signal", () => {
  it("names a repository outside the task, and does not rescan it", async () => {
    // A watcher of its own, on a session scoped to one repository: the suite's
    // watcher is about the whole root and could not tell the two apart.
    const changed: string[] = [];
    const own = createEventBus();
    const seenHere: WatcherEvent[] = [];
    own.subscribe((event) => seenHere.push(event));
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-signal-"));
    mkdirSync(join(dataDir, "reviews", SESSION), { recursive: true });
    for (const name of ["review.json", "comments.json", "diff.json"]) {
      const from = join(config.dataDir, "reviews", SESSION, name);
      if (existsSync(from)) copyFileSync(from, join(dataDir, "reviews", SESSION, name));
    }
    const review = JSON.parse(
      readFileSync(join(dataDir, "reviews", SESSION, "review.json"), "utf8"),
    ) as { scope: unknown };
    review.scope = [{ repo: REPO, paths: null }];
    writeFileSync(join(dataDir, "reviews", SESSION, "review.json"), JSON.stringify(review));
    writeFileSync(join(dataDir, "current"), `${SESSION}\n`);

    const watching = await startWatcher({
      config: { ...config, dataDir },
      scan: found,
      ...(NATIVE_WATCH ? {} : { recursive: false, pollIntervalMs: 40 }),
      bus: own,
      activity: createActivityLog(),
      onRepositoryChanged: (repo) => changed.push(repo),
      onError: () => undefined,
    });
    const outside = join(root, OTHER_REPO, "signal-outside.ts");
    const inside = join(root, REPO, "signal-inside.ts");
    const until = async (holds: () => boolean): Promise<void> => {
      const deadline = performance.now() + 20_000;
      while (!holds() && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 5));
      }
    };
    // This watcher is not the suite's, so the suite's `arm` says nothing about
    // it: a freshly established watch can miss the first write to a tree, which
    // is what `arm` exists for. Neither "it arrived" nor "it did not" means
    // anything until the instrument is known to be live.
    const armOwn = async (repo: string): Promise<void> => {
      const deadline = performance.now() + 30_000;
      for (let attempt = 0; ; attempt += 1) {
        const file = join(root, repo, `signal-armed-${attempt}.ts`);
        const before = changed.length;
        await writeFile(file, `export const armed = ${attempt};\n`);
        const patience = performance.now() + 2_000;
        while (performance.now() < patience) {
          if (changed.length > before) {
            // The removal is a change of its own; waiting for it leaves the
            // watcher with nothing in flight when the assertions start.
            const seen = changed.length;
            await rm(file, { force: true });
            await until(() => changed.length > seen);
            return;
          }
          await new Promise((done) => setTimeout(done, 5));
        }
        await rm(file, { force: true });
        if (performance.now() > deadline) throw new Error(`the watch of ${repo} never armed`);
      }
    };
    try {
      await armOwn(REPO);
      await armOwn(OTHER_REPO);
      changed.length = 0;
      seenHere.length = 0;

      // Outside the scope: announced, and no rescan — the signal exists so a
      // window on another task hears about it (07-server.md).
      await writeFile(outside, "export const outside = 1;\n");
      await until(() => changed.includes(OTHER_REPO));
      expect(changed).toContain(OTHER_REPO);
      expect(
        seenHere.some((event) => event.type === "diff-changed" && event.repo === OTHER_REPO),
      ).toBe(false);

      // Inside it: both, and the signal comes from the rescan rather than from
      // the burst, so it means the change set moved.
      await writeFile(inside, "export const inside = 1;\n");
      await until(() =>
        seenHere.some((event) => event.type === "diff-changed" && event.repo === REPO),
      );
      expect(changed).toContain(REPO);

      // The claim the two call sites exist for: a file written with the bytes
      // it already had moved no line, so it announces nothing. Counted rather
      // than looked for, because "nothing arrived" is only an answer once
      // something else has.
      const settledCount = changed.filter((repo) => repo === REPO).length;
      await writeFile(inside, "export const inside = 1;\n");
      // The barrier: a second write in the other repository, whose signal comes
      // from the burst and therefore always comes. Waiting for it is what makes
      // the count below a verdict instead of a race.
      const barrier = changed.filter((repo) => repo === OTHER_REPO).length;
      await writeFile(outside, "export const outside = 2;\n");
      await until(() => changed.filter((repo) => repo === OTHER_REPO).length > barrier);
      expect(changed.filter((repo) => repo === REPO).length).toBe(settledCount);
    } finally {
      await watching.close();
      rmSync(dataDir, { recursive: true, force: true });
      await rm(outside, { force: true });
      await rm(inside, { force: true });
      await settle();
    }
  }, 60_000);
});

/** One comment as `comments.json` stores it, for a test that writes the file by hand. */
function comment(id: string, body: string): unknown {
  return {
    id,
    version: 2,
    repo: null,
    path: null,
    line: null,
    endLine: null,
    side: "new",
    severity: "nit",
    body,
    author: "kim.p",
    role: "agent",
    status: "open",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
  };
}

describe("the sessions a watcher follows", () => {
  it("hears a second task's comments, and does not replay the ones it opened on", async () => {
    const own = createEventBus();
    const seenHere: WatcherEvent[] = [];
    own.subscribe((event) => seenHere.push(event));
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-follow-"));
    // Two tasks: the current one, and one no window would have reached before.
    for (const name of [SESSION, "followed"]) {
      mkdirSync(join(dataDir, "reviews", name), { recursive: true });
      for (const file of ["review.json", "comments.json", "diff.json"]) {
        const from = join(config.dataDir, "reviews", SESSION, file);
        if (existsSync(from)) copyFileSync(from, join(dataDir, "reviews", name, file));
      }
    }
    // The second task opens with comments already in it: that history is the
    // baseline, not news, or a window would get all of it as new threads.
    const theirs = join(dataDir, "reviews", "followed", "comments.json");
    const held = JSON.parse(readFileSync(theirs, "utf8")) as { comments: unknown[] };
    expect(held.comments.length).toBeGreaterThan(0);
    writeFileSync(join(dataDir, "current"), `${SESSION}\n`);

    let watched: string[] = [];
    const watching = await startWatcher({
      config: { ...config, dataDir },
      scan: found,
      ...(NATIVE_WATCH ? {} : { recursive: false, pollIntervalMs: 40 }),
      bus: own,
      activity: createActivityLog(),
      sessions: () => watched,
      onError: () => undefined,
    });
    const commentsOf = (session: string): WatcherEvent[] =>
      seenHere.filter((event) => event.type === "comment-added" && event.session === session);
    const until = async (holds: () => boolean): Promise<void> => {
      const deadline = performance.now() + 20_000;
      while (!holds() && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 5));
      }
    };
    // The data directory's watch is the same `watchTree` the repositories get,
    // and on the native path its `ready` is `Promise.resolve()` — it says
    // nothing about when the OS starts delivering. So this watcher is armed
    // too: a write is made and waited for before anything is measured.
    const armData = async (): Promise<void> => {
      const file = join(dataDir, "reviews", SESSION, "comments.json");
      const deadline = performance.now() + 30_000;
      for (let attempt = 0; ; attempt += 1) {
        const list = JSON.parse(readFileSync(file, "utf8")) as { comments: unknown[] };
        list.comments.push(comment(`c_arm${attempt}`, "arming the data watch"));
        writeFileSync(file, JSON.stringify(list));
        const patience = performance.now() + 2_000;
        while (performance.now() < patience) {
          if (commentsOf(SESSION).length > 0) return;
          await new Promise((done) => setTimeout(done, 5));
        }
        if (performance.now() > deadline)
          throw new Error("the watch of the data directory never armed");
      }
    };
    try {
      await armData();
      seenHere.length = 0;

      // The task joins the watched set carrying history. Nothing is announced
      // for it: the burst that notices it reads the file as the baseline.
      watched = ["followed"];
      writeFileSync(
        join(dataDir, "reviews", "followed", "review.json"),
        readFileSync(join(dataDir, "reviews", "followed", "review.json"), "utf8"),
      );
      await new Promise((done) => setTimeout(done, 400));
      expect(commentsOf("followed")).toEqual([]);

      // Now a real write into it, which is the thing DA-55.1 exists for.
      const file = join(dataDir, "reviews", "followed", "comments.json");
      const list = JSON.parse(readFileSync(file, "utf8")) as { comments: unknown[] };
      list.comments.push(comment("c_followed", "written into a task that is not current"));
      writeFileSync(file, JSON.stringify(list));
      await until(() => commentsOf("followed").length > 0);
      expect(commentsOf("followed")).toHaveLength(1);
      // And the frame says whose it is, which is what lets a window drop it.
      expect(commentsOf("followed")[0]).toMatchObject({ session: "followed", id: "c_followed" });
      // The current session heard nothing: the write was not in its file.
      expect(commentsOf(SESSION)).toEqual([]);
    } finally {
      await watching.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("closing a watcher", () => {
  it("waits for the rescan in flight, so nothing is written after it resolves", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-drain-"));
    mkdirSync(join(dataDir, "reviews", SESSION), { recursive: true });
    for (const name of ["review.json", "comments.json", "diff.json"]) {
      const from = join(config.dataDir, "reviews", SESSION, name);
      if (existsSync(from)) copyFileSync(from, join(dataDir, "reviews", SESSION, name));
    }
    writeFileSync(join(dataDir, "current"), `${SESSION}\n`);
    const own = createEventBus();
    const changed: string[] = [];
    own.subscribe((event) => {
      if (event.type === "diff-changed") changed.push(event.repo);
    });
    const failing = new Map<string, () => void>();
    const draining = await startWatcher({
      config: { ...config, dataDir },
      scan: found,
      bus: own,
      activity: createActivityLog(),
      pollIntervalMs: 40,
      native: (options, onFailure) => {
        failing.set(options.dir, onFailure);
        return { polling: false, ready: Promise.resolve(), close: () => undefined };
      },
    });
    const file = join(root, REPO, "drained.ts");
    try {
      await writeFile(file, "export const drained = 1;\n");
      (failing.get(join(root, REPO)) as () => void)();
      const deadline = performance.now() + 20_000;
      while (changed.length === 0 && performance.now() < deadline) {
        await new Promise((done) => setTimeout(done, 1));
      }
      expect(changed).toContain(REPO);

      // The event goes out from inside the rescan, before `diff.json` is
      // written: the queue is holding the lock at exactly this moment.
      await draining.close();
      const cache = await readDiffCache(dataDir, SESSION);
      expect(
        cache?.repositories
          .find((one) => one.path === REPO)
          ?.files.some((one) => one.path === "drained.ts"),
      ).toBe(true);

      // And nothing follows the close: a removed data directory stays removed
      // for as long as the suite's own watcher takes to do a whole round trip.
      rmSync(dataDir, { recursive: true, force: true });
      await settle();
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      await draining.close();
      rmSync(dataDir, { recursive: true, force: true });
      await rm(file, { force: true });
      await settle();
    }
  }, 60_000);
});

describe("the activity feed", () => {
  it("names the agent that wrote recently and forgets it after the window", () => {
    let now = 1_000;
    const log = createActivityLog({ now: () => now, editingWindowMs: 100 });
    log.wrote("replied", "claude", REPO, "src/a.ts");
    expect(log.diffChanged(REPO)).toMatchObject({ verb: "editing", author: "claude" });
    now += 200;
    expect(log.diffChanged(REPO)).toMatchObject({ verb: "changed", author: null });
    expect(log.diffChanged(OTHER)).toMatchObject({ verb: "changed", author: null });
  }, 30_000);

  it("keeps only the last events", () => {
    const log = createActivityLog({ capacity: 3 });
    for (let index = 0; index < 5; index += 1) log.diffChanged(`repo-${index}`);
    expect(log.recent().map((event) => event.repo)).toEqual(["repo-2", "repo-3", "repo-4"]);
    expect(log.recent(4).map((event) => event.id)).toEqual([5]);
  }, 30_000);
});
