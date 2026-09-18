/**
 * The watcher ([ADR-005](../../../docs/adr/adr-005-live-update.md)): it watches
 * the reviewed repositories and the data directory, rescans one repository when
 * its files change, rewrites that repository's entry in `diff.json`, and puts
 * what happened on the event bus. It reads repositories and writes nothing into
 * them; the only file it writes is the change-set cache of the data directory
 * (`docs/SPEC.md` section 11).
 */
import { relative } from "node:path";
import { filterChange, sameBase, sameScope, scanReview, totalsOf } from "../change-set.ts";
import type { Config } from "../config/index.ts";
import { repositoryInScope } from "../domain/scope.ts";
import { checkIgnore, readRepositoryChange } from "../git/index.ts";
import { byCodePoint } from "../order.ts";
import { globToRegExp } from "../scanner/index.ts";
import type {
  Comment,
  CommentStatus,
  DiffCache,
  Review,
  ReviewStatus,
  Scope,
} from "../storage/index.ts";
import {
  listSessionNames,
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
import type { Ignore, TreeWatcher, TreeWatcherOptions } from "./tree.ts";
import { supportsRecursiveWatch, watchTree } from "./tree.ts";

export type { ActivityEvent, ActivityLog, ActivityVerb } from "./activity.ts";
export { ACTIVITY_CAPACITY, createActivityLog, EDITING_WINDOW_MS } from "./activity.ts";
export type { EventBus, Listener, WatcherEvent, WatcherEventType } from "./bus.ts";
export { createEventBus } from "./bus.ts";
export type { Ignore, PathKind, TreeSource, TreeWatcher, TreeWatcherOptions } from "./tree.ts";
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
  /** A watch died and the walk took its place; said once (05-watcher.md). */
  onFallback?: () => void;
  /** The native watch of every tree. A test that has to fail one brings its own. */
  native?: TreeWatcherOptions["native"];
};

export type Watcher = {
  /** The review session the watcher writes into: the current one, as it changes. */
  session: () => string | null;
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
  // What the current session is about, so a repository the task is not about
  // costs it no git process when its files change.
  let scope: Scope = (await readSessionOrNull(config, session))?.scope ?? null;
  // `null` until a listing of `reviews/` succeeds: without a baseline nothing
  // is news, and the first readable listing becomes it.
  let sessions: Map<string, ReviewStatus> | null = await snapshotSessions(config, null);
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let fellBack = false;

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
        report(error);
      }
    });
  }

  /** The runtime gave up, not one tree: the trees after the first say the same thing. */
  function reportFallback(): void {
    if (fellBack) return;
    fellBack = true;
    options.onFallback?.();
  }

  /** Reporting a failure is not allowed to become one. */
  function report(error: unknown): void {
    try {
      options.onError?.(error);
    } catch {
      // The reporter's own failure ends here.
    }
  }

  /** What git said about a repository's paths, kept between bursts (05-watcher.md). */
  const ignoredPaths = new Map<string, Map<string, boolean>>();

  /** Whether git ignores every path of this burst: one `check-ignore` per repository per window. */
  async function burstIsIgnored(repository: Repository, paths: string[]): Promise<boolean> {
    if (paths.length === 0) return false;
    const cache = ignoredPaths.get(repository.path) ?? new Map<string, boolean>();
    ignoredPaths.set(repository.path, cache);
    if (dropsVerdicts(paths, cache)) return false;
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
    // A repository the task is not about is watched but not read: the scope
    // decides what the review is, and reading it would cost four git processes
    // to produce a change set nothing may show
    // ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)). Watching it
    // anyway is what makes a scope that widens while the server runs take
    // effect without a restart.
    if (!repositoryInScope(scope, repo)) return;
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
    await reloadSessions();
  }

  async function reloadCurrent(): Promise<void> {
    const next = await readCurrent(config.dataDir);
    if (next === session) return;
    session = next;
    // The comments of the session switched to are not news: they are the new
    // baseline, and a file that cannot be read is the same transition as below.
    comments = await snapshotComments(config, session, report);
    metadata = await readMetadata(config, session);
    scope = (await readSessionOrNull(config, session))?.scope ?? null;
    if (session !== null) bus.emit({ type: "session-changed", name: session });
  }

  /**
   * Every session, not only the current one: a task created or closed anywhere
   * in the data directory is news for an open window, which says a new task
   * appeared without becoming it (`docs/SPEC.md` section 5). A session that
   * disappears says nothing — deleting one is Phase 2 (DA-40).
   */
  async function reloadSessions(): Promise<void> {
    const next = await snapshotSessions(config, sessions);
    // The directory could not be listed. What was known stays known: replacing
    // it with an empty snapshot would make every session news again on the next
    // readable pass, and a few hundred of those would push the replay out of
    // the stream's ring ([07-server.md](../../../docs/reference/07-server.md)).
    if (next === null) return;
    if (sessions === null) {
      sessions = next;
      return;
    }
    for (const [name, status] of next) {
      if (sessions.get(name) !== status) bus.emit({ type: "sessions-changed", name, status });
    }
    sessions = next;
  }

  async function reloadComments(): Promise<void> {
    if (session === null) return;
    let list: Comment[];
    try {
      list = await readComments(config.dataDir, session);
    } catch (error) {
      // The rest of the chain still runs: a file broken by hand stops the
      // comment events, not the metadata and session-list ones.
      if (comments !== null) report(error);
      comments = null;
      return;
    }
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
    scope = (await readSessionOrNull(config, session))?.scope ?? null;
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
        // The walk that replaced the watch opened on a silent baseline, so the
        // repository is read whole: an edit made during the takeover is in it.
        onFallback: () => {
          schedule(`repo:${repository.path}`, () => enqueue(() => rescan(repository)));
          reportFallback();
        },
        ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
        ...(options.native === undefined ? {} : { native: options.native }),
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
      // Read again for the same reason a repository is: the three files may
      // have moved while nothing was watching them.
      onFallback: () => {
        schedule("data", () => enqueue(reloadData));
        reportFallback();
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.native === undefined ? {} : { native: options.native }),
    }),
  );

  // Nothing is watched until every tree says it is: a change made in the
  // moment between starting and being watched would otherwise be absorbed into
  // the baseline of the walk and never reported.
  await Promise.all(watchers.map((watcher) => watcher.ready));

  return {
    session: () => session,
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
  // there, while the review response of the server drops them for speed. What
  // the task is not about comes back empty and drops out of the cache, the way
  // a repository without changes does.
  const change = filterChange(
    review.scope,
    await readRepositoryChange(config.root, repo, review.base, { hunks: true }),
  );

  const patched = await withLock(sessionDir(config.dataDir, session), async (held) => {
    const cached = await readDiffCache(config.dataDir, session);
    // The full scan is read outside the lock: it takes as long as every
    // repository takes, and the CLI writes the same directory meanwhile. A
    // cache computed against another base, or for another scope, is read again
    // for the same reason it is in the server — it answers a different
    // question.
    if (
      cached === null ||
      !sameBase(cached.base, review.base) ||
      !sameScope(cached.scope, review.scope)
    ) {
      return null;
    }

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

  const { cache } = await scanReview(config, review.base, review.scope);
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

/** The comments now, or `null` when unreadable: the next readable version is the baseline. */
async function snapshotComments(
  config: Config,
  session: string | null,
  onFailure?: (error: unknown) => void,
): Promise<Map<string, CommentState> | null> {
  if (session === null) return new Map();
  try {
    return snapshotOf(await readComments(config.dataDir, session));
  } catch (error) {
    onFailure?.(error);
    return null;
  }
}

/** The part of `review.json` that is the review rather than the moment of its last write. */
function metadataOf(review: Review): string {
  return JSON.stringify({
    name: review.name,
    title: review.title,
    base: review.base,
    scope: review.scope,
    status: review.status,
  });
}

async function readMetadata(config: Config, session: string | null): Promise<string | null> {
  const review = await readSessionOrNull(config, session);
  return review === null ? null : metadataOf(review);
}

/**
 * `review.json` of a session, or `null` when it cannot be read: a session named
 * by `current` that is not there yet, or a file being rewritten as it is read.
 * The next change reads it again.
 */
async function readSessionOrNull(config: Config, session: string | null): Promise<Review | null> {
  if (session === null) return null;
  try {
    return await readReview(config.dataDir, session);
  } catch {
    return null;
  }
}

/**
 * The status of every session in the data directory, or `null` when `reviews/`
 * itself could not be listed — which is a failed read and not an empty data
 * directory. It is read on every burst the data directory produces, one small
 * file per session; a data directory with hundreds of sessions pays for that
 * here as it already does on every `listSessions`
 * ([04-domain.md](../../../docs/reference/04-domain.md)).
 *
 * A session whose `review.json` could not be read this time keeps the status it
 * had, for the same reason: a file caught mid-write is not a task that changed.
 */
export async function snapshotSessions(
  config: Config,
  previous: Map<string, ReviewStatus> | null,
): Promise<Map<string, ReviewStatus> | null> {
  let names: string[];
  try {
    ({ names } = await listSessionNames(config.dataDir));
  } catch {
    return null;
  }
  const snapshot = new Map<string, ReviewStatus>();
  for (const name of names) {
    const review = await readSessionOrNull(config, name);
    const status = review?.status ?? previous?.get(name);
    if (status !== undefined) snapshot.set(name, status);
  }
  return snapshot;
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

/** Whether a burst's names make git's answers stale, and so a change in itself (05-watcher.md). */
export function dropsVerdicts(paths: string[], cache: Map<string, boolean>): boolean {
  if (!paths.some((path) => changesWhatGitIgnores(path) || insideGitDir(path))) return false;
  cache.clear();
  return true;
}

/** Whether a change of this path changes what git ignores in its repository. */
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
