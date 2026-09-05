/**
 * The watcher of [ADR-005](../docs/adr/adr-005-live-update.md): an edit in one
 * repository reaches `diff.json` and the event bus inside the budget of
 * `docs/SPEC.md` section 6, and a write into the data directory from another
 * process becomes comment events.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { scanReview } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { scan } from "../src/core/index.ts";
import {
  diffCachePath,
  readComments,
  readDiffCache,
  updateComments,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import type { ScanResult } from "../src/core/types.ts";
import type { ActivityEvent, EventBus, Watcher, WatcherEvent } from "../src/core/watcher/index.ts";
import {
  createActivityLog,
  createEventBus,
  dataIgnore,
  repositoryIgnore,
  rescanRepository,
  startWatcher,
  supportsRecursiveWatch,
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
    await rescanRepository(config, SESSION, REPO, found);
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
}, 120_000);

afterAll(() => {
  watcher?.close();
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
    // `docs/SPEC.md` section 6 gives 300 ms from the edit to the update. Most
    // of that is the rescan itself — four git processes and a rewrite of the
    // cache — and what it costs is what the machine charges for them: on a
    // machine running the rest of this suite in parallel, several times what
    // it costs on a quiet one. So what is asserted here is the budget on top
    // of one rescan timed in the same conditions, which is the watcher\'s own
    // share: the debounce and the delivery of the event. The flat 300 ms is
    // measured on a quiet machine by `bun run perf`, and
    // `docs/reference/05-watcher.md` records both.
    process.stderr.write(`update after an edit: ${median(elapsed).toFixed(1)} ms\n`);
    // Only where the tree is watched. On the walk the number is the interval
    // and the cost of the walk itself, which is why a platform without a
    // recursive watch cannot meet this budget at all.
    if (NATIVE_WATCH) expect(median(elapsed)).toBeLessThan(BUDGET_MS + (await baseline()));
  }, 30_000);

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
    // The session does not exist, so nothing is announced; the pointer is read
    // and the watcher stops writing into a session that is no longer current.
    await new Promise((done) => setTimeout(done, 4 * BUDGET_MS));
    expect(watcher.session()).toBe(`${SESSION}-other`);
    expect(
      since(mark, "session-changed").map((one) => (one.event as { name: string }).name),
    ).toEqual([`${SESSION}-other`]);
    await writeFile(join(config.dataDir, "current"), `${SESSION}\n`);
    await waitFor("session-changed", performance.now() - 1);
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
    await waitFor("session-changed", switched);
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
    await waitFor("session-changed", performance.now() - 1);
    const mark = performance.now();
    await writeFile(file, "export const broken = 2;\n");
    const hit = await waitFor("diff-changed", mark);
    expect((hit.event as { repo: string }).repo).toBe(REPO);
  }, 30_000);
});

describe("what a repository's watch reports", () => {
  it("keeps the two files of .git that move with the change set and drops the rest", () => {
    const ignore = repositoryIgnore(config, {
      path: REPO,
      absolutePath: join(root, REPO),
      kind: "repo",
    });
    expect(ignore(".git/HEAD", "file")).toBe(false);
    expect(ignore(".git/index", "file")).toBe(false);
    expect(ignore(".git/objects/ff/0123", "file")).toBe(true);
    expect(ignore(".git/objects", "dir")).toBe(true);
    expect(ignore(".git", "dir")).toBe(false);
    // A runtime that reports the directory rather than the file inside it
    // would otherwise never say that HEAD moved.
    expect(ignore(".git", "file")).toBe(false);
    expect(ignore("src/a.ts", "file")).toBe(false);
    expect(ignore("node_modules/left-pad/index.js", "file")).toBe(true);
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
