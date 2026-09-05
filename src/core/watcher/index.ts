/**
 * The watcher ([ADR-005](../../../docs/adr/adr-005-live-update.md)): it watches
 * the reviewed repositories and the data directory, rescans one repository when
 * its files change, rewrites that repository's entry in `diff.json`, and puts
 * what happened on the event bus. It reads repositories and writes nothing into
 * them; the only file it writes is the change-set cache of the data directory
 * (`docs/SPEC.md` section 11).
 */
import { relative } from "node:path";
import { sameBase, scanReview, totalsOf } from "../change-set.ts";
import type { Config } from "../config/index.ts";
import { checkIgnore, readRepositoryChange } from "../git/index.ts";
import { byCodePoint } from "../order.ts";
import { globToRegExp } from "../scanner/index.ts";
import type { Comment, CommentStatus, DiffCache, Review } from "../storage/index.ts";
import {
  readComments,
  readCurrent,
  readDiffCache,
  readReview,
  sessionDir,
  withLock,
  writeDiffCache,
} from "../storage/index.ts";
import type { Repository, RepositoryChange, ScanResult, ScanWarning } from "../types.ts";
import type { ActivityLog } from "./activity.ts";
import type { EventBus } from "./bus.ts";
import type { Ignore, TreeWatcher } from "./tree.ts";
import { supportsRecursiveWatch, watchTree } from "./tree.ts";

export type { ActivityEvent, ActivityLog, ActivityVerb } from "./activity.ts";
export { ACTIVITY_CAPACITY, createActivityLog, EDITING_WINDOW_MS } from "./activity.ts";
export type { EventBus, Listener, WatcherEvent, WatcherEventType } from "./bus.ts";
export { createEventBus } from "./bus.ts";
export type { Ignore, PathKind, TreeWatcher } from "./tree.ts";
export {
  DEFAULT_POLL_INTERVAL_MS,
  PROBE_TIMEOUT_MS,
  supportsRecursiveWatch,
  watchTree,
} from "./tree.ts";

/** How long a repository stays quiet before it is rescanned. */
export const DEFAULT_DEBOUNCE_MS = 100;

/**
 * How long a repository whose files never stop changing waits at most. Without
 * it a build writing into the working tree would restart the debounce for as
 * long as it runs and the review would never update.
 */
export const MAX_DEBOUNCE_MS = 1_000;

/**
 * How many of git's ignore verdicts one repository keeps. A build writing
 * thousands of distinct paths would otherwise grow the cache for as long as the
 * server runs; past this the oldest answers go and are asked again if those
 * paths come back.
 */
export const IGNORE_CACHE_LIMIT = 4_096;

export type WatcherOptions = {
  config: Config;
  /** The repositories to watch and what the scan that found them had to say. */
  scan: ScanResult;
  bus: EventBus;
  activity: ActivityLog;
  debounceMs?: number;
  pollIntervalMs?: number;
  /**
   * `false` walks every tree instead of watching it. The default asks the
   * runtime, which is right on a local disk; a filesystem whose notifications
   * cannot be trusted — a network mount, or a runtime whose watch goes quiet —
   * is what this is for.
   */
  recursive?: boolean;
  /** The change set as it now stands, for a caller that keeps it in memory. */
  onRescan?: (cache: DiffCache) => void;
  /** A rescan that failed. Without this the failure is silent. */
  onError?: (error: unknown) => void;
};

export type Watcher = {
  /** The review session the watcher writes into: the current one, as it changes. */
  session: () => string | null;
  /** `true` while any watched tree is walked on a timer instead of watched. */
  polling: () => boolean;
  close: () => void;
};

/**
 * Starts watching. The session it works on is the current one; when `current`
 * changes underneath, the watcher follows it, so a session created from the UI
 * or by `review use` needs no restart.
 */
export async function startWatcher(options: WatcherOptions): Promise<Watcher> {
  const { activity, bus, config, scan } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const waiting = new Map<string, number>();
  const pending = new Map<string, Set<string>>();
  const watchers: TreeWatcher[] = [];
  // Asked once: whether the watch recurses is a property of the runtime, not of
  // a directory, and the answer decides for every tree below. A caller that
  // already knows the answer is not asked to prove it.
  const recursive = options.recursive ?? (await supportsRecursiveWatch(config.dataDir));
  let session = await readCurrent(config.dataDir);
  let comments: Map<string, CommentState> | null = await snapshotComments(config, session);
  let metadata = await readMetadata(config, session);
  let queue: Promise<void> = Promise.resolve();
  let closed = false;

  /**
   * Debounce with a ceiling: a change resets the wait, but never past
   * `MAX_DEBOUNCE_MS` after the first one, so a burst that does not end still
   * produces a rescan.
   */
  function schedule(key: string, run: () => void): void {
    const first = waiting.get(key) ?? Date.now();
    waiting.set(key, first);
    clearTimeout(timers.get(key));
    const wait = Math.max(0, Math.min(debounceMs, first + MAX_DEBOUNCE_MS - Date.now()));
    const timer = setTimeout(() => {
      timers.delete(key);
      waiting.delete(key);
      if (!closed) run();
    }, wait);
    timer.unref?.();
    timers.set(key, timer);
  }

  /**
   * Rescans run one at a time: two of them write the same `diff.json`, and
   * queueing them here costs less than making each wait for the session lock.
   * A failure is reported and dropped — the queue has to stay usable, and a
   * reporter that throws must not take it down either.
   */
  function enqueue(work: () => Promise<void>): void {
    queue = queue.then(async () => {
      if (closed) return;
      try {
        await work();
      } catch (error) {
        try {
          options.onError?.(error);
        } catch {
          // Reporting a failure is not allowed to become one.
        }
      }
    });
  }

  /**
   * What git said about the paths of a repository, kept between bursts. The
   * rules change only when a `.gitignore` or `.git/info/exclude` does, and
   * asking git about the same `dist/` file on every write of a build would cost
   * the process this cache is here to save. It holds `IGNORE_CACHE_LIMIT`
   * paths per repository, oldest out first.
   */
  const ignoredPaths = new Map<string, Map<string, boolean>>();

  /**
   * Whether git ignores every path of this burst. One `git check-ignore` per
   * repository per debounce window answers for the whole burst, and a burst
   * that is all build output — `dist/`, `target/`, a coverage report — is not a
   * change of the review: rescanning it costs four git processes and a rewrite
   * of the cache for nothing (`docs/SPEC.md` section 6).
   *
   * A path that changes what git ignores is never ignored itself and drops
   * what was cached for that repository: `.gitignore` and `.git/info/exclude`
   * hold the rules, and `.git/index` decides which files they apply to at all,
   * since a tracked file is never reported as ignored.
   *
   * Nothing under `.git` is ever suppressed, and the check is on the whole
   * burst rather than a filter over it. git makes no exception for `.git`
   * — under a `.gitignore` that starts with `*`, `check-ignore` answers that
   * `.git/HEAD` is ignored — so a burst that is a commit or a branch switch
   * would be swallowed and the review's base go stale without a word.
   */
  async function burstIsIgnored(repository: Repository, paths: string[]): Promise<boolean> {
    if (paths.length === 0) return false;
    const cache = ignoredPaths.get(repository.path) ?? new Map<string, boolean>();
    ignoredPaths.set(repository.path, cache);
    if (paths.some(changesWhatGitIgnores)) {
      cache.clear();
      return false;
    }
    if (paths.some(insideGitDir)) return false;
    const unknown = paths.filter((path) => !cache.has(path));
    if (unknown.length > 0) {
      const ignored = await checkIgnore(repository.absolutePath, unknown);
      // git had no answer. Nothing is kept from that, and the burst is treated
      // as the change it may well be.
      if (ignored === null) return false;
      for (const path of unknown) cache.set(path, ignored.has(path));
    }
    // Trimmed after the answer is read, which leaves a burst larger than the
    // cap correct: what was just asked is what decides it.
    const answer = paths.every((path) => cache.get(path) === true);
    trimVerdicts(cache);
    return answer;
  }

  async function rescan(repository: Repository): Promise<void> {
    const repo = repository.path;
    const files = [...(pending.get(repo) ?? [])].sort(byCodePoint);
    pending.delete(repo);
    if (session === null) return;
    // A build writing into a directory git ignores restarts the debounce for as
    // long as it runs, and the ceiling then forces a rescan a second that can
    // find nothing. Asking git first costs one process instead of four.
    if (await burstIsIgnored(repository, files)) return;
    // Announced from inside the rescan, before `diff.json` is written: what the
    // person sees must not wait for a file of megabytes. A file that was
    // touched without its content changing — a build output, a save with the
    // same bytes — is not a change of the review and says nothing at all.
    await rescanRepository(config, session, repo, scan, (outcome) => {
      options.onRescan?.(outcome.cache);
      bus.emit({ type: "diff-changed", repo, files });
      activity.diffChanged(repo);
      if (outcome.warningsChanged) bus.emit({ type: "warnings", list: outcome.cache.warnings });
    });
  }

  /** The three files of the data directory, in the order a change of one affects the others. */
  async function reloadData(): Promise<void> {
    await reloadCurrent();
    await reloadComments();
    await reloadMetadata();
  }

  async function reloadCurrent(): Promise<void> {
    const next = await readCurrent(config.dataDir);
    if (next === session) return;
    session = next;
    // The comments of the session being switched to are not news: they are
    // read as the new baseline, and only what happens next is an event.
    comments = await snapshotComments(config, session);
    metadata = await readMetadata(config, session);
    if (session !== null) bus.emit({ type: "session-changed", name: session });
  }

  async function reloadComments(): Promise<void> {
    if (session === null) return;
    const list = await readComments(config.dataDir, session);
    // Nothing was read the last time — a file being written as it was read, or
    // one broken by hand and since repaired. What is in it now is the baseline,
    // not two hundred comments that were all just added.
    if (comments === null) {
      comments = snapshotOf(list);
      return;
    }
    for (const comment of list) {
      const before = comments.get(comment.id);
      if (before === undefined) {
        bus.emit({ type: "comment-added", id: comment.id });
        recordWrite(activity, "commented", comment.role, comment.author, comment);
        continue;
      }
      if (before.status !== comment.status) {
        bus.emit({ type: "comment-status", id: comment.id });
      }
      for (const reply of comment.replies.slice(before.replies)) {
        bus.emit({ type: "reply-added", id: reply.id, commentId: comment.id });
        recordWrite(activity, "replied", reply.role, reply.author, comment);
      }
    }
    comments = snapshotOf(list);
  }

  /**
   * `review.json` is rewritten by every comment write, because a write bumps
   * `updatedAt`. Only a change to what the review is — its base, its title, its
   * name — is a session change.
   */
  async function reloadMetadata(): Promise<void> {
    if (session === null) return;
    const next = await readMetadata(config, session);
    if (next === metadata) return;
    metadata = next;
    bus.emit({ type: "session-changed", name: session });
  }

  for (const repository of scan.repositories) {
    const ignore = repositoryIgnore(config, repository);
    watchers.push(
      watchTree({
        dir: repository.absolutePath,
        ignore,
        recursive,
        onChange: (path) => {
          const files = pending.get(repository.path) ?? new Set<string>();
          files.add(path);
          pending.set(repository.path, files);
          schedule(`repo:${repository.path}`, () => enqueue(() => rescan(repository)));
        },
        ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      }),
    );
  }

  watchers.push(
    watchTree({
      dir: config.dataDir,
      ignore: dataIgnore,
      recursive,
      // One handler for the whole data directory rather than one per file. A
      // whole-file write is a temporary file and a rename over the target, and
      // a runtime is free to report any of the three names — Node reports the
      // file, Bun reports the temporary one, and Bun under a test runner
      // reports only the directory the change was under. So anything that is
      // not the change-set cache or the lock means "read the three files
      // again"; each read is compared with the last, so a read that finds
      // nothing new says nothing.
      onChange: () => {
        schedule("data", () => enqueue(reloadData));
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    }),
  );

  // Nothing is watched until every tree says it is: a change made in the
  // moment between starting and being watched would otherwise be absorbed into
  // the baseline of the walk and never reported.
  await Promise.all(watchers.map((watcher) => watcher.ready));

  return {
    session: () => session,
    polling: () => watchers.some((watcher) => watcher.polling()),
    close: () => {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers) watcher.close();
    },
  };
}

export type Rescan = {
  /** The change set as it now stands on disk. */
  cache: DiffCache;
  /** Whether this repository's entry is not what it was. */
  changed: boolean;
  /** Whether the warnings of the change set are not what they were. */
  warningsChanged: boolean;
};

/**
 * The new change set, handed over the moment it exists and before it is
 * written. `diff.json` of a real review is megabytes, and writing it is the
 * slowest step of a rescan: an update the person is waiting for must not wait
 * for that too (`docs/SPEC.md` section 6). The file follows a moment later, and
 * a write that fails is repaired by the next rescan.
 */
export type Ready = (rescan: Rescan) => void;

/**
 * Recomputes one repository and puts it in place of its entry in `diff.json`,
 * under the session's lock: the CLI writes the same directory, and a rescan
 * that read outside the lock would overwrite what it wrote. A repository left
 * without changes drops out of the cache, the way a scan leaves it out.
 *
 * Without a cache — or with one computed against another base — there is
 * nothing to patch, and a cache holding the one repository that changed would
 * be read as a review of one repository, so the whole change set is read
 * instead. The base the cache records is the session's, and a patched cache
 * keeps it.
 */
export async function rescanRepository(
  config: Config,
  session: string,
  repo: string,
  scan: ScanResult,
  ready?: Ready,
): Promise<Rescan> {
  const review = await readReview(config.dataDir, session);
  // `diff.json` is the only place the hunks live: anchor capture reads them
  // there, while the review response of the server drops them for speed.
  const change = await readRepositoryChange(config.root, repo, review.base, { hunks: true });

  const patched = await withLock(sessionDir(config.dataDir, session), async (held) => {
    const cached = await readDiffCache(config.dataDir, session);
    // The full scan is read outside the lock: it takes as long as every
    // repository takes, and the CLI writes the same directory meanwhile. A
    // cache computed against another base is read again for the same reason it
    // is in the server — it answers a different question.
    if (cached === null || !sameBase(cached.base, review.base)) return null;

    const before = cached.repositories.find((one) => one.path === repo) ?? null;
    if (sameChange(before, change)) {
      return { cache: cached, changed: false, warningsChanged: false };
    }

    const repositories = cached.repositories.filter((one) => one.path !== repo);
    if (change.files.length > 0) repositories.push(change);
    repositories.sort((a, b) => byCodePoint(a.path, b.path));

    // Everything the cache says about the other repositories stands; what it
    // said about this one is replaced by what this read and the scan say now.
    const warnings = [
      ...cached.warnings.filter((one) => one.path !== repo),
      ...scan.warnings.filter((one) => one.path === repo),
      ...change.warnings.map((message) => ({ path: repo, message })),
    ].sort((a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message));

    const cache: DiffCache = {
      ...cached,
      repositories,
      totals: totalsOf(repositories),
      warnings,
    };
    const outcome: Rescan = {
      cache,
      changed: true,
      warningsChanged: !sameWarnings(cached.warnings, warnings),
    };
    ready?.(outcome);
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
    return outcome;
  });
  if (patched !== null) return patched;

  const { cache } = await scanReview(config, review.base);
  const outcome: Rescan = { cache, changed: true, warningsChanged: true };
  ready?.(outcome);
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
  });
  return outcome;
}

/**
 * Whether the recomputed entry says anything the cached one did not. The patch
 * is the content, so comparing it is comparing the change itself.
 */
function sameChange(before: RepositoryChange | null, after: RepositoryChange): boolean {
  if (before === null) return after.files.length === 0;
  if (before.branch !== after.branch) return false;
  if (before.files.length !== after.files.length) return false;
  if (before.warnings.join("\n") !== after.warnings.join("\n")) return false;
  if (before.base?.sha !== after.base?.sha || before.base?.ref !== after.base?.ref) return false;
  return before.files.every((file, index) => {
    const other = after.files[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.omitted === other.omitted &&
      file.patch === other.patch
    );
  });
}

function sameWarnings(before: ScanWarning[], after: ScanWarning[]): boolean {
  return (
    before.length === after.length &&
    before.every((one, index) => {
      const other = after[index];
      return other !== undefined && one.path === other.path && one.message === other.message;
    })
  );
}

/** What a comment looked like at the last read: enough to tell what changed. */
type CommentState = { status: CommentStatus; replies: number };

function snapshotOf(comments: Comment[]): Map<string, CommentState> {
  return new Map(
    comments.map((comment) => [
      comment.id,
      { status: comment.status, replies: comment.replies.length },
    ]),
  );
}

/**
 * The comments as they are now, or `null` when they could not be read: a file
 * broken by hand is not a reason for the server not to start, and the watcher
 * takes the next readable version as its baseline.
 */
async function snapshotComments(
  config: Config,
  session: string | null,
): Promise<Map<string, CommentState> | null> {
  if (session === null) return new Map();
  try {
    return snapshotOf(await readComments(config.dataDir, session));
  } catch {
    return null;
  }
}

/** The part of `review.json` that is the review rather than the moment of its last write. */
function metadataOf(review: Review): string {
  return JSON.stringify({ name: review.name, title: review.title, base: review.base });
}

async function readMetadata(config: Config, session: string | null): Promise<string | null> {
  if (session === null) return null;
  try {
    return metadataOf(await readReview(config.dataDir, session));
  } catch {
    // A session named by `current` that is not there yet, or a file being
    // rewritten as it is read: the next change reads it again.
    return null;
  }
}

/**
 * Only an agent's write is news ([ADR-005](../../../docs/adr/adr-005-live-update.md)):
 * the feed exists to show the human what the agents did, and their own comment
 * is not something they have to be told about.
 */
function recordWrite(
  activity: ActivityLog,
  verb: "commented" | "replied",
  role: Comment["role"],
  author: string,
  comment: Comment,
): void {
  if (role !== "agent") return;
  activity.wrote(verb, author, comment.repo, comment.path);
}

/**
 * Drops the oldest of a repository's ignore verdicts until it is inside
 * `IGNORE_CACHE_LIMIT`. A `Map` keeps insertion order, so the oldest answers
 * are its first keys, and a path dropped here is simply asked again.
 */
export function trimVerdicts(cache: Map<string, boolean>): void {
  for (const path of cache.keys()) {
    if (cache.size <= IGNORE_CACHE_LIMIT) break;
    cache.delete(path);
  }
}

/** The repository-local exclude file, whose rules are git's as much as a `.gitignore`'s. */
const IGNORE_RULES_EXCLUDE = ".git/info/exclude";

/**
 * Whether a change of this path changes what git ignores in its repository.
 * `.gitignore` and `.git/info/exclude` hold the rules; `.git/index` decides
 * which files the rules reach at all, because a tracked file is never reported
 * as ignored — without it, one `git add -f` on a build output would leave every
 * later edit of a now-tracked file suppressed by a cached verdict. Each is news
 * on its own and makes every cached verdict of that repository stale.
 */
function changesWhatGitIgnores(path: string): boolean {
  if (path === IGNORE_RULES_EXCLUDE || path === ".git/index") return true;
  return path === ".gitignore" || path.endsWith("/.gitignore");
}

/** Whether the path is git's own directory, or anything the watch reports inside it. */
function insideGitDir(path: string): boolean {
  return path === ".git" || path.startsWith(".git/");
}

/**
 * What a repository's watch reports. Inside `.git` everything is noise except
 * `HEAD`, `index`, and `info/exclude` — the first two move when the base of the
 * change set does and the third holds ignore rules — but
 * `.git` itself is not, because a runtime that reports the directory rather
 * than the file inside it (Bun does) would otherwise never say that HEAD moved;
 * `node_modules` and the `exclude` globs of the configuration are out; and so
 * is the data directory, on the one root that is a repository itself — without
 * that, writing `diff.json` would wake the watcher that wrote it. What git
 * itself ignores is left to git, once per burst, rather than guessed here.
 */
export function repositoryIgnore(config: Config, repository: Repository): Ignore {
  const exclude = config.exclude.map(globToRegExp);
  const inside = relative(repository.absolutePath, config.dataDir);
  const dataDir = inside === "" || inside.startsWith("..") ? null : inside.split("\\").join("/");

  return (path, kind) => {
    const segments = path.split("/");
    if (segments.includes("node_modules")) return true;
    if (segments[0] === ".git") {
      // The directory itself is walked into, for the two files at its top and
      // the exclude file one level down, and it is a signal in its own right
      // when that is all a runtime reports.
      if (segments.length === 1) return false;
      if (kind === "dir") return path !== ".git/info";
      return path !== ".git/HEAD" && path !== ".git/index" && path !== IGNORE_RULES_EXCLUDE;
    }
    if (dataDir !== null && (path === dataDir || path.startsWith(`${dataDir}/`))) return true;
    const name = segments.at(-1) as string;
    return exclude.some((pattern) => pattern.test(name) || pattern.test(path));
  };
}

/**
 * What the data directory's watch reports: everything except the change-set
 * cache, which the watcher writes itself. The lock is in — it is not data, but
 * a runtime that coalesces the changes of one directory into a single event
 * (macOS does, and Bun reports what is left) can hand back the lock as the only
 * name for a write that changed a session's files. Every one of them is the
 * same signal anyway, since the reload reads the three files and compares them
 * with the last read.
 */
export const dataIgnore: Ignore = (path) =>
  writtenFile(path.split("/").at(-1) as string) === "diff.json";

/**
 * The file a change is about: `comments.json.tmp-<uuid>` is `comments.json`,
 * because that is what `writeFileAtomic` is in the middle of writing. Only the
 * last segment is read, so a directory whose own name holds `.tmp-` is left
 * alone.
 */
function writtenFile(path: string): string {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const cut = name.indexOf(".tmp-");
  return cut === -1 ? path : path.slice(0, slash + 1) + name.slice(0, cut);
}
