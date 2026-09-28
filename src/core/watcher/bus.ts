/** The in-process event bus ([ADR-005](../../../docs/adr/adr-005-live-update.md)): what the watcher
 * noticed, for the server's SSE stream and the activity feed (05-watcher.md, "Events"). */
import type { ReviewStatus } from "../storage/types.ts";
import type { ScanWarning } from "../types.ts";

/** One thing that changed. The names and payloads are the wire shape too: the server forwards
 * them as named SSE events ([07-server.md](../../../docs/reference/07-server.md), "The live stream"). */
export type WatcherEvent =
  /** One repository's change set was recomputed; `files` are the paths that woke the watcher. */
  | { type: "diff-changed"; repo: string; files: string[] }
  /** `session` is the task the thread belongs to: a window on another one drops it. */
  | { type: "comment-added"; session: string; id: string }
  /** `id` is the reply, `commentId` the thread it landed in. */
  | { type: "reply-added"; session: string; id: string; commentId: string }
  | { type: "comment-status"; session: string; id: string }
  /** The metadata of a followed session changed: its base, title, name, scope or status. */
  | { type: "session-changed"; name: string }
  /** `current` now points at this session. A window with no `?review=` follows
   * that pointer and re-reads; one on a task of its own does not. */
  | { type: "current-changed"; name: string }
  /** A review task appeared, or a task's status changed, current or not: a window hears of a task
   * without becoming it ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)). */
  | { type: "sessions-changed"; name: string; status: ReviewStatus }
  | { type: "warnings"; list: ScanWarning[] };

type Listener = (event: WatcherEvent) => void;

export type EventBus = {
  emit: (event: WatcherEvent) => void;
  /** Returns the call that stops the subscription. */
  subscribe: (listener: Listener) => () => void;
};

/** Delivered over a copy of the list, so a listener unsubscribing mid-delivery — a closing SSE
 * stream — does not shorten it under the loop (05-watcher.md, "Events"). */
export function createEventBus(): EventBus {
  const listeners = new Set<Listener>();
  return {
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
