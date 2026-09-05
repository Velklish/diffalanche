/**
 * The in-process event bus ([ADR-005](../../../docs/adr/adr-005-live-update.md)):
 * what the watcher noticed, in one typed union, delivered to whoever is
 * listening inside this process. The SSE stream of the server is one listener;
 * the activity feed is built from the same events.
 */
import type { ScanWarning } from "../types.ts";

/**
 * One thing that changed. The names and payloads are the wire shape too: the
 * server forwards them as named SSE events with this object as the data.
 */
export type WatcherEvent =
  /** One repository's change set was recomputed; `files` are the paths that woke the watcher. */
  | { type: "diff-changed"; repo: string; files: string[] }
  | { type: "comment-added"; id: string }
  /** `id` is the reply, `commentId` the thread it landed in. */
  | { type: "reply-added"; id: string; commentId: string }
  | { type: "comment-status"; id: string }
  /** The current session changed, or the metadata of the current one did. */
  | { type: "session-changed"; name: string }
  | { type: "warnings"; list: ScanWarning[] };

export type WatcherEventType = WatcherEvent["type"];

export type Listener = (event: WatcherEvent) => void;

export type EventBus = {
  emit: (event: WatcherEvent) => void;
  /** Returns the call that stops the subscription. */
  subscribe: (listener: Listener) => () => void;
};

/**
 * A listener is called in the order it subscribed, over a copy of the list: a
 * listener that unsubscribes itself while an event is being delivered — which
 * is what a closing SSE stream does — does not shorten the list under the loop.
 */
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
