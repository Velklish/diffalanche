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
import { readRepositoryChange } from "../git/index.ts";
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

export type WatcherOptions = {
  config: Config;
  /** The repositories to watch and what the scan that found them had to say. */
  scan: ScanResult;
  bus: EventBus;
  activity: ActivityLog;
  debounceMs?: number;
  pollIntervalMs?: number;
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
  // a directory, and the answer decides for every tree below.
  const recursive = await supportsRecursiveWatch(config.dataDir);
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

  async function rescan(repo: string): Promise<void> {
    const files = [...(pending.get(repo) ?? [])].sort(byCodePoint);
    pending.delete(repo);
    if (session === null) return;
    const outcome = await rescanRepository(config, session, repo, scan);
    // A file that was touched without its content changing — a build output, a
    // saved file with the same bytes — is not a change of the review.
    if (!outcome.changed) return;
    options.onRescan?.(outcome.cache);
    bus.emit({ type: "diff-changed", repo, files });
    activity.diffChanged(repo);
    if (outcome.warningsChanged) bus.emit({ type: "warnings", list: outcome.cache.warnings });
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
          schedule(`repo:${repository.path}`, () => enqueue(() => rescan(repository.path)));
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
      onChange: (path) => {
        if (path === "current") {
          schedule("data:current", () => enqueue(reloadCurrent));
          return;
        }
        if (session === null) return;
        if (path === `reviews/${session}/comments.json`) {
          schedule("data:comments", () => enqueue(reloadComments));
          return;
        }
        if (path === `reviews/${session}/review.json`) {
          schedule("data:review", () => enqueue(reloadMetadata));
        }
      },
      ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    }),
  );

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
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
    return { cache, changed: true, warningsChanged: !sameWarnings(cached.warnings, warnings) };
  });
  if (patched !== null) return patched;

  const { cache } = await scanReview(config, review.base);
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, cache);
  });
  return { cache, changed: true, warningsChanged: true };
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
 * What a repository's watch reports. Everything inside `.git` is noise except
 * `HEAD` and `index`, which move when the base of the change set does;
 * `node_modules` and the `exclude` globs of the configuration are out; and so
 * is the data directory, on the one root that is a repository itself — without
 * that, writing `diff.json` would wake the watcher that wrote it.
 */
export function repositoryIgnore(config: Config, repository: Repository): Ignore {
  const exclude = config.exclude.map(globToRegExp);
  const inside = relative(repository.absolutePath, config.dataDir);
  const dataDir = inside === "" || inside.startsWith("..") ? null : inside.split("\\").join("/");

  return (path, kind) => {
    const segments = path.split("/");
    if (segments.includes("node_modules")) return true;
    if (segments[0] === ".git") {
      return kind === "dir" ? segments.length > 1 : path !== ".git/HEAD" && path !== ".git/index";
    }
    if (dataDir !== null && (path === dataDir || path.startsWith(`${dataDir}/`))) return true;
    const name = segments.at(-1) as string;
    return exclude.some((pattern) => pattern.test(name) || pattern.test(path));
  };
}

/**
 * What the data directory's watch reports: the three files that carry a change
 * somebody else made. `diff.json` is left out because the watcher writes it,
 * and the `.lock` directory because it is a lock and not data.
 */
const dataIgnore: Ignore = (path, kind) => {
  const segments = path.split("/");
  if (segments.includes(".lock")) return true;
  if (kind === "dir") return false;
  const name = segments.at(-1) as string;
  return name !== "current" && name !== "comments.json" && name !== "review.json";
};
