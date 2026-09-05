/**
 * The activity feed ([ADR-005](../../../docs/adr/adr-005-live-update.md)): what
 * the server noticed while a review is open, derived from the watcher's events
 * and capped at the last few hundred. Events live in memory and are gone when
 * the server stops, so nothing here is written to disk.
 */

/** The verb of a feed line; the UI writes the sentence around it. */
export type ActivityVerb =
  /** The change set of a repository changed and nobody is known to be editing it. */
  | "changed"
  /** An agent that wrote in this repository recently is still changing it. */
  | "editing"
  | "replied"
  | "commented";

/**
 * One line of the feed. The target is `repo`, and `path` inside it when the
 * event is about a file; both are `null` for a comment on the whole review.
 */
export type ActivityEvent = {
  /** Position in the feed, counted from one; the UI keys rows by it. */
  id: number;
  verb: ActivityVerb;
  /** The name on the write; `null` when nothing named one. */
  author: string | null;
  repo: string | null;
  path: string | null;
  at: string;
};

/** How many events the feed keeps. */
export const ACTIVITY_CAPACITY = 200;

/** How long a write keeps naming the author of the changes in that repository. */
export const EDITING_WINDOW_MS = 120_000;

export type ActivityLog = {
  /**
   * A comment or a reply was written. The author is remembered for the
   * repository, so the diff changes that follow are attributed to them.
   */
  wrote: (
    verb: "commented" | "replied",
    author: string,
    repo: string | null,
    path: string | null,
  ) => ActivityEvent;
  /** A repository's change set changed. */
  diffChanged: (repo: string) => ActivityEvent;
  /** The feed, oldest first; `afterId` gives only what came after that line. */
  recent: (afterId?: number) => ActivityEvent[];
};

export type ActivityOptions = {
  capacity?: number;
  editingWindowMs?: number;
  /** The clock, so a test does not have to wait two minutes. */
  now?: () => number;
  /** Called with every line as it is recorded; the SSE stream listens here. */
  onRecord?: (event: ActivityEvent) => void;
};

export function createActivityLog(options: ActivityOptions = {}): ActivityLog {
  const capacity = options.capacity ?? ACTIVITY_CAPACITY;
  const editingWindowMs = options.editingWindowMs ?? EDITING_WINDOW_MS;
  const now = options.now ?? Date.now;
  const events: ActivityEvent[] = [];
  /** The last agent write per repository: who, and when. */
  const writers = new Map<string, { author: string; at: number }>();
  let nextId = 1;

  function push(event: Omit<ActivityEvent, "id" | "at">): ActivityEvent {
    const recorded: ActivityEvent = { id: nextId, at: new Date(now()).toISOString(), ...event };
    nextId += 1;
    events.push(recorded);
    if (events.length > capacity) events.splice(0, events.length - capacity);
    options.onRecord?.(recorded);
    return recorded;
  }

  return {
    wrote(verb, author, repo, path) {
      if (repo !== null) writers.set(repo, { author, at: now() });
      return push({ verb, author, repo, path });
    },
    diffChanged(repo) {
      const writer = writers.get(repo);
      // Past the window the author is forgotten rather than kept as a stale
      // claim that somebody is still working there.
      if (writer && now() - writer.at > editingWindowMs) writers.delete(repo);
      const current = writers.get(repo);
      return current
        ? push({ verb: "editing", author: current.author, repo, path: null })
        : push({ verb: "changed", author: null, repo, path: null });
    },
    recent(afterId) {
      return afterId === undefined ? [...events] : events.filter((event) => event.id > afterId);
    },
  };
}
