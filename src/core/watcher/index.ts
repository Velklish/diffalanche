/** The watcher ([ADR-005](../../../docs/adr/adr-005-live-update.md)): it reads repositories and
 * writes only the data directory's change-set cache ([05-watcher.md](../../../docs/reference/05-watcher.md)). */
import { relative } from "node:path";
import { filterChange, patchable, replaceRepository, scanReview } from "../change-set.ts";
import type { Config } from "../config/index.ts";
import { commentInScope, repositoryInScope } from "../domain/scope.ts";
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
import type { Ignore, PathKind, TreeWatcher, TreeWatcherOptions } from "./tree.ts";
import { supportsRecursiveWatch, watchTree } from "./tree.ts";

export type { ActivityEvent, ActivityLog } from "./activity.ts";
export { createActivityLog } from "./activity.ts";
export type { EventBus, WatcherEvent } from "./bus.ts";
export { createEventBus } from "./bus.ts";
export type { TreeSource } from "./tree.ts";
export {
  probeRecursiveWatch,
  supportsRecursiveWatch,
  watchTree,
} from "./tree.ts";

/** How long a repository stays quiet before it is rescanned. */
const DEFAULT_DEBOUNCE_MS = 100;

/** The debounce's ceiling: a build that never stops writing would otherwise never be rescanned
 * (05-watcher.md, "Events"). */
const MAX_DEBOUNCE_MS = 1_000;

/** Ignore verdicts kept per repository, oldest out first, so a build writing thousands of distinct
 * paths cannot grow the cache for as long as the server runs (05-watcher.md). */
export const IGNORE_CACHE_LIMIT = 4_096;

export type WatcherOptions = {
  config: Config;
  /** The repositories to watch, as the scan found them; its warnings are the cache's to keep. */
  scan: ScanResult;
  bus: EventBus;
  activity: ActivityLog;
  debounceMs?: number;
  pollIntervalMs?: number;
  /** `false` walks every tree instead of watching it: for a network mount, or a runtime whose watch
   * goes quiet (05-watcher.md). The default asks the runtime. */
  recursive?: boolean;
  /** The change set as it now stands, with the session it belongs to, for a caller
   * that keeps it in memory ([05-watcher.md](../../../docs/reference/05-watcher.md)). */
  onRescan?: (session: string, cache: DiffCache) => void;
  /** A repository that moved, whatever the current task is about: inside the
   * task's scope it means the change set did, outside it means files were written. */
  onRepositoryChanged?: (repo: string) => void;
  /** The tasks windows are open on, asked on every burst of the data directory
   * ([05-watcher.md](../../../docs/reference/05-watcher.md)). */
  sessions?: () => string[];
  /** Every session's `review.json` as a burst of the data directory listed it, for a holder that
   * compares what it holds: a session gone, or made again under its name (05-watcher.md, DA-40). */
  onSessions?: (reviews: ReadonlyMap<string, Review | null>) => void;
  /** The data directory changed, said on the change itself and before any burst is read:
   * whatever it wrote, about whichever task (05-watcher.md). */
  onDataChanged?: () => void;
  /** A rescan that failed. Without this the failure is silent. */
  onError?: (error: unknown) => void;
  /** A watch died and the walk took its place; said once (05-watcher.md). */
  onFallback?: () => void;
  /** The walk from the start, which nobody asked for: the runtime has no recursive watch, or
   * `watch` refused a tree. Said once, and not for `recursive: false` (05-watcher.md). */
  onWalk?: () => void;
  /** The native watch of every tree. A test that has to fail one brings its own. */
  native?: TreeWatcherOptions["native"];
};

export type Watcher = {
  /** The review session the watcher writes into: the current one, as it changes. */
  session: () => string | null;
  /** Reads that session's whole change set from the working tree, in the queue of rescans: what
   * a server does before its first document ([07-server.md](../../../docs/reference/07-server.md)). */
  refresh: () => Promise<void>;
  /** A window was served that task: its comments and `review.json` are what the burst that
   * starts following it compares with ([05-watcher.md](../../../docs/reference/05-watcher.md)). */
  served: (name: string, review: Review, comments: readonly Comment[]) => void;
  /** The last window on that task went away: what it was served goes with it, whether or not a
   * burst ever followed the task meanwhile (05-watcher.md). */
  left: (name: string) => void;
  /** Stops watching and waits for the rescan in flight; nothing is written after it resolves. */
  close: () => Promise<void>;
};

/** Starts watching the current session and follows `current` as it moves, so a session made from
 * the UI or by `review use` needs no restart (05-watcher.md, "Starting it"). */
export async function startWatcher(options: WatcherOptions): Promise<Watcher> {
  const { activity, bus, config, scan } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const waiting = new Map<string, number>();
  const pending = new Map<string, Set<string>>();
  const watchers: TreeWatcher[] = [];
  // Asked once: whether the watch recurses is the runtime's property, not a directory's, and it
  // decides for every tree below.
  const recursive = options.recursive ?? (await supportsRecursiveWatch(config.dataDir));
  let session = await readCurrent(config.dataDir);
  // Per session, because a window open on a task hears about that task's
  // comments and not only about the current one's (DA-55.1).
  const comments = new Map<string, Map<string, CommentState> | null>();
  const metadata = new Map<string, string | null>();
  // The oldest document served of each task not yet followed: kept through the bursts that drop what
  // nobody follows, until one follows the task, it leaves the followed set, or it is gone (05-watcher.md).
  const served = new Map<string, Served>();
  if (session !== null) {
    comments.set(session, await snapshotComments(config, session));
    metadata.set(session, await readMetadata(config, session));
  }
  // What the current session is about, so a repository the task is not about
  // costs it no git process when its files change.
  let scope: Scope = (await readSessionOrNull(config, session))?.scope ?? null;
  // `null` until a listing of `reviews/` succeeds: without a baseline nothing
  // is news, and the first readable listing becomes it.
  let sessions: Map<string, ReviewStatus> | null = await snapshotSessions(config, null);
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  let fellBack = false;
  // The repositories rescanned since `current` last moved; until then a rescan that finds
  // nothing may be an edit the move's read took in, which no other task heard of (05-watcher.md).
  const settled = new Set<string>(scan.repositories.map((repository) => repository.path));

  /** Debounce with a ceiling: a change resets the wait, never past `MAX_DEBOUNCE_MS` after the
   * first, so a burst that does not end still produces a rescan. */
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

  /** One at a time, since two rescans write the same `diff.json`; a failure is reported and dropped
   * so the queue stays usable (05-watcher.md, "Starting it" and "Events"). */
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
    // A build writing where git ignores forces a rescan a second that finds nothing; asking git
    // first costs one process where a rescan costs five (05-watcher.md).
    if (await burstIsIgnored(repository, files)) return;
    // Taken once: the rescan is about the session it started on, and `current`
    // may move under it while the five git processes run.
    const followed = session;
    // Outside the task's scope a repository is watched, so a widened scope needs no restart, and
    // not read: five git processes for a change set nothing may show (05-watcher.md, ADR-010).
    if (followed === null || !repositoryInScope(scope, repo)) {
      // Nothing will read this repository, so nothing can say whether its
      // content changed: the burst is all there is to report (05-watcher.md).
      options.onRepositoryChanged?.(repo);
      return;
    }
    // Announced before `diff.json` is written, and only when the entry moved: a save with the same
    // bytes says nothing (05-watcher.md, "The change-set cache").
    const rescanned = await rescanRepository(config, followed, repo, (outcome) => {
      options.onRescan?.(followed, outcome.cache);
      // From inside the rescan, so it says the change set moved rather than
      // that a file was written: a save with the same bytes reaches no one.
      options.onRepositoryChanged?.(repo);
      bus.emit({ type: "diff-changed", repo, files });
      activity.diffChanged(repo);
      if (outcome.warningsChanged) bus.emit({ type: "warnings", list: outcome.cache.warnings });
    });
    // Once per repository per move, the repository is said to have moved whatever the rescan
    // found: it compared with a cache the move's read wrote, not with what others hold.
    if (!rescanned.changed && !settled.has(repo)) options.onRepositoryChanged?.(repo);
    settled.add(repo);
  }

  /** The tasks followed: the current one, and the ones windows are open on. */
  function followedSessions(): string[] {
    const named = new Set<string>(options.sessions?.() ?? []);
    if (session !== null) named.add(session);
    return [...named];
  }

  /** The three files of the data directory, in the order a change of one affects the others. */
  async function reloadData(): Promise<void> {
    await reloadCurrent();
    const followed = followedSessions();
    await reloadComments(followed);
    // One read of every `review.json` for the burst, handed to the metadata comparison and the
    // listing both, so following more sessions costs no extra read (05-watcher.md).
    const listed = await readSessions(config);
    // A failed listing is not an empty data directory: the followed sessions still go through the
    // same comparison, or this burst's change is never announced (05-watcher.md, "Events").
    const reviews = listed ?? (await readFollowed(config, followed));
    reloadMetadata(followed, reviews);
    for (const name of followed) served.delete(name);
    if (listed === null) return;
    for (const name of [...served.keys()]) if (!listed.has(name)) served.delete(name);
    reloadSessions(listed);
    options.onSessions?.(listed);
  }

  /** A session's whole change set read from the working tree and handed over, where a `diff.json` last
   * written when it was last followed is there to replace; the answer is what moved since that file. */
  async function readWhole(name: string | null, review: Review | null): Promise<Moved> {
    const moved: Moved = { repositories: [], warnings: null };
    // A session that cannot be read is the first document's to report, not this one's.
    if (name === null || review === null) return moved;
    // Without a cache the first document reads the working tree itself, and a read here would be a second.
    const before = await readDiffCache(config.dataDir, name);
    if (before === null) return moved;
    await rescanSession(config, name, review, ({ cache }) => {
      options.onRescan?.(name, cache);
      const paths = new Set([...before.repositories, ...cache.repositories].map((one) => one.path));
      for (const repo of [...paths].sort(byCodePoint)) {
        const was = before.repositories.find((one) => one.path === repo) ?? null;
        const now = cache.repositories.find((one) => one.path === repo) ?? null;
        // A repository that left the change set moved as surely as one that changed in it.
        if (now === null || !sameChange(was, now)) moved.repositories.push(repo);
      }
      if (!sameWarnings(before.warnings, cache.warnings)) moved.warnings = cache.warnings;
    });
    return moved;
  }

  /** What a read on the way to a session found moved, said once the watcher follows it (07-server.md). */
  function announce(moved: Moved): void {
    // No activity line: this is the state the task is in, not something that just happened in it.
    for (const repo of moved.repositories) {
      options.onRepositoryChanged?.(repo);
      bus.emit({ type: "diff-changed", repo, files: [] });
    }
    if (moved.warnings !== null) bus.emit({ type: "warnings", list: moved.warnings });
  }

  async function reloadCurrent(): Promise<void> {
    const next = await readCurrent(config.dataDir);
    if (next === session) return;
    // What the session is, taken before its change set: a change made during that read is then news,
    // where a baseline taken after it swallowed it.
    const review = await readSessionOrNull(config, next);
    // Read before it is followed: until then its document comes from the working tree, not from a
    // cache nothing refreshed. A read that fails is reported, and the session followed all the same.
    const moved = await readWhole(next, review).catch((error: unknown): Moved => {
      report(error);
      return { repositories: [], warnings: null };
    });
    session = next;
    settled.clear();
    if (session === null) return;
    // The comments of the session switched to are the new baseline, not news; a session a window
    // was already on keeps the snapshot it has.
    if (!comments.has(session)) {
      comments.set(session, await snapshotComments(config, session, report));
    }
    // A session a window was already on keeps its baseline, as it keeps its comments.
    if (!metadata.has(session)) metadata.set(session, review === null ? null : metadataOf(review));
    scope = review?.scope ?? null;
    // The pointer moved; what the session *is* has not changed, and the two are
    // different news for different windows ([08-ui.md](../../../docs/reference/08-ui.md)).
    bus.emit({ type: "current-changed", name: session });
    // After the frame: a window on the pointer reads the whole review on it, and a window on the task
    // by name needs to hear which repositories moved while nothing followed it.
    announce(moved);
  }

  /** Every session's status, news for any open window; a session that disappears says nothing, the
   * frame having no status for it ([05-watcher.md](../../../docs/reference/05-watcher.md)). */
  function reloadSessions(reviews: Map<string, Review | null>): void {
    // A failed listing never reaches here: what was known stays known, or every session is news
    // again on the next readable burst (05-watcher.md, "Events").
    const next = statusesOf(reviews, sessions);
    if (sessions === null) {
      sessions = next;
      return;
    }
    for (const [name, status] of next) {
      if (sessions.get(name) !== status) bus.emit({ type: "sessions-changed", name, status });
    }
    sessions = next;
  }

  async function reloadComments(followed: string[]): Promise<void> {
    // A session no window is on stops being read and its snapshot goes: opening it again reads the
    // file as the new baseline rather than replaying it.
    for (const name of [...comments.keys()]) {
      if (followed.includes(name)) continue;
      comments.delete(name);
      // A document it was served while followed is not what the next window on it will hold.
      served.delete(name);
    }
    for (const name of followed) await reloadCommentsOf(name);
  }

  async function reloadCommentsOf(name: string): Promise<void> {
    const before = comments.get(name);
    let list: Comment[];
    try {
      list = await readComments(config.dataDir, name);
    } catch (error) {
      // The rest of the chain still runs: a file broken by hand stops the
      // comment events, not the metadata and session-list ones.
      if (before !== undefined && before !== null) report(error);
      comments.set(name, null);
      return;
    }
    // Asked after the read, so a write after a document served meanwhile is not lost; that document
    // can be newer than the read, which costs a frame seen twice or one found gone (05-watcher.md).
    const taken = before === undefined ? served.get(name) : undefined;
    const baseline = before ?? taken?.comments;
    // Nothing read last time — a file caught mid-write, one repaired by hand, a task opened unserved:
    // what is in it now is the baseline, not two hundred comments that were all just added.
    if (baseline === undefined || baseline === null) {
      comments.set(name, snapshotOf(list));
      return;
    }
    for (const comment of list) {
      const was = baseline.get(comment.id);
      if (was === undefined) {
        // Outside the scope the document had, a comment was never in it to be missed.
        if (taken !== undefined && !commentInScope(taken.scope, comment)) continue;
        bus.emit({ type: "comment-added", session: name, id: comment.id });
        recordWrite(activity, "commented", comment.role, comment.author, comment);
        continue;
      }
      if (was.status !== comment.status) {
        bus.emit({ type: "comment-status", session: name, id: comment.id });
      }
      for (const reply of comment.replies.slice(was.replies)) {
        bus.emit({ type: "reply-added", session: name, id: reply.id, commentId: comment.id });
        recordWrite(activity, "replied", reply.role, reply.author, comment);
      }
    }
    comments.set(name, snapshotOf(list));
  }

  /** Every comment write bumps `updatedAt` in `review.json`; only a change to what the review is —
   * base, title, name, scope or status — is a session change (05-watcher.md, "Events"). */
  function reloadMetadata(followed: string[], reviews: Map<string, Review | null>): void {
    for (const name of [...metadata.keys()]) {
      if (followed.includes(name)) continue;
      metadata.delete(name);
      served.delete(name);
    }
    for (const name of followed) {
      const review = reviews.get(name) ?? null;
      const next = review === null ? null : metadataOf(review);
      const taken = metadata.has(name) ? undefined : served.get(name);
      if (taken !== undefined) metadata.set(name, taken.metadata);
      if (metadata.has(name) && metadata.get(name) === next) continue;
      const known = metadata.has(name);
      metadata.set(name, next);
      // A task a window opened unserved is not a task that changed: its
      // metadata is read as the baseline, the way its comments are.
      if (!known) continue;
      if (name === session) scope = review?.scope ?? null;
      bus.emit({ type: "session-changed", name });
    }
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
      // One signal for the whole directory, not a name to match: a runtime may report the target,
      // the temporary file or only the directory (05-watcher.md, "What it watches…").
      onChange: () => {
        options.onDataChanged?.();
        schedule("data", () => enqueue(reloadData));
      },
      // Read again for the same reason a repository is: the three files may
      // have moved while nothing was watching them.
      onFallback: () => {
        options.onDataChanged?.();
        schedule("data", () => enqueue(reloadData));
        reportFallback();
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.native === undefined ? {} : { native: options.native }),
    }),
  );

  // Asked before any tree can have fallen back, so a tree polling now polled from the start.
  const walking = options.recursive !== false && watchers.some((watcher) => watcher.polling());
  // Resolved only once every tree is watched: a change made before the walk's baseline would be
  // absorbed into it (05-watcher.md, "Starting it").
  await Promise.all(watchers.map((watcher) => watcher.ready));
  if (walking) {
    // One line for the session: a later takeover would say the same thing again.
    fellBack = true;
    options.onWalk?.();
  }

  return {
    session: () => session,
    left: (name) => {
      served.delete(name);
    },
    served: (name, review, list) => {
      // The oldest one: a later window's is newer, and what landed between the two would be lost.
      if (served.has(name)) return;
      served.set(name, {
        comments: snapshotOf(list),
        metadata: metadataOf(review),
        scope: review.scope,
      });
    },
    refresh: () => {
      // Nothing is announced: no window can be listening before the first document.
      enqueue(async () => {
        await readWhole(session, await readSessionOrNull(config, session));
      });
      return queue;
    },
    close: async () => {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers) watcher.close();
      // The rescan inside `work()` still holds the session lock and is about to
      // write; a close that resolved first would let a teardown remove the tree.
      await queue;
    },
  };
}

/** What a read on the way to a session found different from the `diff.json` it replaced. */
type Moved = { repositories: string[]; warnings: ScanWarning[] | null };

type Rescan = {
  /** The change set as it now stands on disk. */
  cache: DiffCache;
  /** Whether this repository's entry is not what it was. */
  changed: boolean;
  /** Whether the warnings of the change set are not what they were. */
  warningsChanged: boolean;
};

/** The new change set, handed over before it is written: writing megabytes of `diff.json` is the
 * slowest step of a rescan (05-watcher.md, "The change-set cache"). */
type Ready = (rescan: Rescan) => void;

/** One repository patched into `diff.json` under the session's lock, or the whole change set read
 * when the cache cannot be patched (05-watcher.md, "The change-set cache"). */
export async function rescanRepository(
  config: Config,
  session: string,
  repo: string,
  ready?: Ready,
): Promise<Rescan> {
  const review = await readReview(config.dataDir, session);
  // With hunks: `diff.json` is the only place they live, and anchor capture reads them there
  // (05-watcher.md, "The change-set cache").
  const change = filterChange(
    review.scope,
    await readRepositoryChange(config.root, repo, review.base, { hunks: true }),
  );

  const patched = await withLock(sessionDir(config.dataDir, session), async (held) => {
    const cached = await readDiffCache(config.dataDir, session);
    // A cache for another base or scope answers a different question; the full scan that replaces
    // it runs outside the lock, since it takes as long as every repository takes.
    if (!patchable(cached, review.base, review.scope)) return null;

    const before = cached.repositories.find((one) => one.path === repo) ?? null;
    if (sameChange(before, change)) {
      return { cache: cached, changed: false, warningsChanged: false };
    }

    const cache = replaceRepository(cached, change);
    const outcome: Rescan = {
      cache,
      changed: true,
      warningsChanged: !sameWarnings(cached.warnings, cache.warnings),
    };
    ready?.(outcome);
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
    return outcome;
  });
  if (patched !== null) return patched;
  return rescanSession(config, session, review, ready);
}

/** The whole change set of a session read again and written, the scan outside the lock and the
 * write inside it: what a rescan falls back to, and what `refresh` is. */
async function rescanSession(
  config: Config,
  session: string,
  review: Review,
  ready?: Ready,
): Promise<Rescan> {
  const { cache } = await scanReview(config, review.base, review.scope);
  const outcome: Rescan = { cache, changed: true, warningsChanged: true };
  ready?.(outcome);
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
  });
  return outcome;
}

/** Whether the recomputed entry says anything the cached one did not; the patch is the content,
 * so comparing it is comparing the change itself. */
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

/** What a window was served of a task, as the watcher compares it; `scope` is what the document
 * showed, the comments outside it having never been in it. */
type Served = { comments: Map<string, CommentState>; metadata: string; scope: Scope };

function snapshotOf(comments: readonly Comment[]): Map<string, CommentState> {
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

/** `review.json` of a session, or `null` when it cannot be read — named by `current` before it
 * exists, or caught mid-rewrite; the next change reads it again. */
async function readSessionOrNull(config: Config, session: string | null): Promise<Review | null> {
  if (session === null) return null;
  try {
    return await readReview(config.dataDir, session);
  } catch {
    return null;
  }
}

/** Every session's `review.json` in one pass, or `null` when `reviews/` itself could
 * not be listed — a failed read, which an empty data directory is not. */
async function readSessions(config: Config): Promise<Map<string, Review | null> | null> {
  let names: string[];
  try {
    ({ names } = await listSessionNames(config.dataDir));
  } catch {
    return null;
  }
  const reviews = new Map<string, Review | null>();
  for (const name of names) reviews.set(name, await readSessionOrNull(config, name));
  return reviews;
}

/** The `review.json` of the followed sessions alone, for a burst whose listing of
 * `reviews/` failed: what is followed is still read and still compared. */
async function readFollowed(
  config: Config,
  followed: string[],
): Promise<Map<string, Review | null>> {
  const reviews = new Map<string, Review | null>();
  for (const name of followed) reviews.set(name, await readSessionOrNull(config, name));
  return reviews;
}

/** The status of every session read this burst. A session whose file could not be
 * read keeps the status it had: a file caught mid-write is not a task that changed. */
function statusesOf(
  reviews: Map<string, Review | null>,
  previous: Map<string, ReviewStatus> | null,
): Map<string, ReviewStatus> {
  const snapshot = new Map<string, ReviewStatus>();
  for (const [name, review] of reviews) {
    const status = review?.status ?? previous?.get(name);
    if (status !== undefined) snapshot.set(name, status);
  }
  return snapshot;
}

/** The status of every session in the data directory, read for a caller that has
 * no burst of its own to share ([04-domain.md](../../../docs/reference/04-domain.md)). */
export async function snapshotSessions(
  config: Config,
  previous: Map<string, ReviewStatus> | null,
): Promise<Map<string, ReviewStatus> | null> {
  const reviews = await readSessions(config);
  return reviews === null ? null : statusesOf(reviews, previous);
}

/** Only an agent's write is news: the feed shows the human what the agents did
 * ([ADR-005](../../../docs/adr/adr-005-live-update.md); 05-watcher.md, "The activity feed"). */
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

/** Drops the oldest verdicts down to `IGNORE_CACHE_LIMIT`: a `Map` keeps insertion order, so they
 * are its first keys, and a dropped path is asked again. */
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

/** Whether the path is a git directory — this repository's or one nested in it — or inside one. */
function insideGitDir(path: string): boolean {
  return path.split("/").includes(".git");
}

/** What a nested repository shows of its git directory: where its gitlink points, nothing else. */
function nestedGitIgnore(rest: string[], kind: PathKind): boolean {
  if (rest.length === 0) return false;
  const position = rest[0] === "HEAD" || rest[0] === "packed-refs";
  const branch = rest[0] === "refs" && (rest.length === 1 || rest[1] === "heads");
  if (kind === "dir") return !branch;
  return !(position && rest.length === 1) && !(branch && rest.length > 2);
}

/** What a repository's watch leaves out, and why each (05-watcher.md, "What it watches…"); what
 * git itself ignores is left to git, once per burst, rather than guessed here. */
export function repositoryIgnore(config: Config, repository: Repository): Ignore {
  const exclude = config.exclude.map(globToRegExp);
  const inside = relative(repository.absolutePath, config.dataDir);
  const dataDir = inside === "" || inside.startsWith("..") ? null : inside.split("\\").join("/");

  return (path, kind) => {
    const segments = path.split("/");
    if (segments.includes("node_modules")) return true;
    const git = segments.indexOf(".git");
    if (git === 0) {
      // `.git` is walked into for `HEAD`, `index` and `info/exclude`, and is a signal of its own
      // when the directory is all a runtime reports.
      if (segments.length === 1) return false;
      if (kind === "dir") return path !== ".git/info";
      return path !== ".git/HEAD" && path !== ".git/index" && path !== IGNORE_RULES_EXCLUDE;
    }
    // A nested repository is never scanned as its own, so its git directory is seen only through
    // this watch (05-watcher.md, "What it watches…").
    if (git > 0) return nestedGitIgnore(segments.slice(git + 1), kind);
    if (dataDir !== null && (path === dataDir || path.startsWith(`${dataDir}/`))) return true;
    const name = segments.at(-1) as string;
    return exclude.some((pattern) => pattern.test(name) || pattern.test(path));
  };
}

/** The data directory's watch leaves out `diff.json` and `index/`, both the tool's own writes; the
 * lock stays in, since it can be the only name a write is reported by (05-watcher.md). */
export const dataIgnore: Ignore = (path) =>
  path.split("/")[0] === "index" || writtenFile(path.split("/").at(-1) as string) === "diff.json";

/** `comments.json.tmp-<uuid>` is `comments.json`, mid-`writeFileAtomic`; only the last segment is
 * read, so a directory whose own name holds `.tmp-` is left alone. */
function writtenFile(path: string): string {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const cut = name.indexOf(".tmp-");
  return cut === -1 ? path : path.slice(0, slash + 1) + name.slice(0, cut);
}
