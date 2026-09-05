/**
 * Live update ([ADR-005](../../docs/adr/adr-005-live-update.md)): the page holds
 * one `EventSource` on `GET /api/events`, fetches what an event names, and
 * patches the store — the review is read again only when an event says so.
 *
 * Reconnection and `Last-Event-ID` are the browser's own: `EventSource` retries
 * a dropped stream and sends back the id of the last frame it saw, which is the
 * reason ADR-005 chose SSE over a socket. What this module adds around that is
 * the `reload` frame, the connection state the sidebar footer shows, and the
 * ring of activity lines a page that has just connected would otherwise start
 * empty with ([07-server.md](../../docs/reference/07-server.md)).
 */
import type { RepositoryChange } from "../core/types.ts";
import type { ActivityEvent } from "../core/watcher/activity.ts";
import type { WatcherEvent } from "../core/watcher/bus.ts";
import { afterPaint, perf } from "./perf.ts";
import { useStore } from "./store.ts";
import type { Comment } from "./types.ts";

/** What the sidebar footer says about the stream. */
export type Connection = "connecting" | "watching" | "reconnecting";

/**
 * Where the reading position is measured, in pixels from the top of the window:
 * just under the 52 px header, the same probe the centre panel picks the
 * current file with.
 */
const PROBE_Y = 62;

/** A shift smaller than this is not worth a scroll: a sub-pixel jitter is not a jump. */
const ANCHOR_EPSILON = 1;

/** How far below the probe the search for the reading column goes, and by how much. */
const PROBE_DEPTH = 240;
const PROBE_STEP = 12;

/**
 * What the reader is looking at and where it sat, taken before a patch is
 * applied. Content that changes above it moves it down the page; putting it
 * back where it was is what keeps the reading position through an agent's edit.
 */
type Anchor = { element: Element; top: number } | null;

export function startLive(): () => void {
  const store = () => useStore.getState();
  const source = new EventSource("/api/events");

  // One queue: two events arriving together are two patches, and a patch that
  // reads the store while another is halfway through it would write back a
  // state that never existed.
  let queue: Promise<void> = Promise.resolve();
  const run = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      // A fetch that failed is a frame lost, not a page lost: the stream is
      // still open and the next event patches over it.
      store().setToast(error instanceof Error ? error.message : String(error));
    });
  };

  // The stream answers as soon as it is subscribed, with a comment line, so
  // this fires on connect rather than fifteen seconds later with the first
  // heartbeat ([07-server.md](../../docs/reference/07-server.md)).
  source.onopen = () => {
    store().setConnection("watching");
    run(readActivity);
  };
  // `EventSource` reconnects on its own; the state says so while it does.
  source.onerror = () => {
    if (source.readyState !== EventSource.CLOSED) store().setConnection("reconnecting");
  };

  const on = <T>(name: string, handle: (data: T) => Promise<void> | void) => {
    source.addEventListener(name, (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as T;
      run(async () => {
        await handle(data);
      });
    });
  };

  on<Extract<WatcherEvent, { type: "diff-changed" }>>("diff-changed", (event) =>
    diffChanged(event.repo),
  );
  on<Extract<WatcherEvent, { type: "comment-added" }>>("comment-added", (event) =>
    thread(event.id),
  );
  on<Extract<WatcherEvent, { type: "reply-added" }>>("reply-added", (event) =>
    thread(event.commentId, event.id),
  );
  on<Extract<WatcherEvent, { type: "comment-status" }>>("comment-status", (event) =>
    thread(event.id),
  );
  on<Extract<WatcherEvent, { type: "session-changed" }>>("session-changed", (event) => {
    // The page's own `use`, `new` and base change come back through the watcher
    // like anyone else's. It has already read the review they name, and reading
    // it again would cost megabytes for nothing.
    if (store().claimSelfSession(event.name)) return;
    return store().loadReview();
  });
  on<Extract<WatcherEvent, { type: "warnings" }>>("warnings", (event) => {
    store().setWarnings(event.list);
  });
  on<ActivityEvent>("activity", (event) => {
    store().pushActivity([event]);
  });
  // The ring can no longer reach back to what this page missed, so nothing here
  // can be repaired event by event: the review is read again.
  on<{ reason: string }>("reload", () => store().loadReview());

  return () => {
    source.close();
    store().setConnection("connecting");
  };
}

/**
 * The feed as the server has it since it started, merged by id: a reconnect
 * replays the frames it missed as well, and a line that arrives twice is one
 * line ([05-watcher.md](../../docs/reference/05-watcher.md)).
 */
async function readActivity(): Promise<void> {
  const response = await fetch("/api/activity");
  if (!response.ok) return;
  useStore.getState().pushActivity((await response.json()) as ActivityEvent[]);
}

/**
 * One repository's change set as it now stands. A 404 is the repository leaving
 * the review — `GET /api/repos/:repo/diff` answers `no-such-repository` when it
 * has no changes left — and is as much of an update as a new diff is.
 */
async function diffChanged(repo: string): Promise<void> {
  const response = await fetch(`/api/repos/${repo}/diff`);
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `the diff of ${repo} could not be read: the server answered ${response.status}`,
    );
  }
  const next = response.ok ? ((await response.json()) as RepositoryChange) : null;
  const anchor = capture();
  useStore.getState().applyRepositoryDiff(repo, next);
  await settle(anchor);
  // The frame that showed the new diff, on the wall clock the harness edits the
  // file by: this is the far end of the 300 ms budget of `docs/SPEC.md`
  // section 6.
  perf.liveUpdate = { repo, at: Date.now() };
}

/**
 * One thread, whichever event named it. `replyId` is the reply that arrived, so
 * an answer from an agent — and only from an agent — reaches the reader as a
 * toast as well as in the rail.
 */
async function thread(id: string, replyId?: string): Promise<void> {
  const response = await fetch(`/api/comments/${id}`);
  if (!response.ok) {
    throw new Error(`the thread ${id} could not be read: the server answered ${response.status}`);
  }
  const comment = (await response.json()) as Comment;
  const anchor = capture();
  const store = useStore.getState();
  store.patchThread(comment);
  const reply =
    replyId === undefined ? undefined : comment.replies.find((one) => one.id === replyId);
  if (reply?.role === "agent") store.setToast(`${reply.author} ответил · ${where(comment)}`);
  await settle(anchor);
}

/** Where a thread is, in the words the toast has room for. */
function where(comment: Comment): string {
  if (comment.repo === null) return "ревью";
  return comment.path === null ? comment.repo : comment.path;
}

/**
 * The narrowest element at the reading position, and the offset it sits at. A
 * patch that grows a card above the reader makes the page taller there, and
 * without this the text under their eyes moves by the difference.
 *
 * It is deliberately not the card or the repository section around that point:
 * a section's own top does not move when a card *inside* it grows, so anchoring
 * to one is anchoring to nothing — measured as a whole hunk of drift on the
 * fixture (`e2e/live.spec.ts`).
 */
function capture(): Anchor {
  const centre = document.querySelector(".centre")?.getBoundingClientRect();
  if (!centre) return null;
  const x = centre.left + centre.width / 2;
  // Down from the probe until the topmost element there belongs to the column
  // that scrolls. The header is sticky and the scanner's warnings bar sits
  // under it at the top of the page: neither moves when a card grows, so an
  // anchor on one of them is an anchor on nothing.
  for (let y = PROBE_Y; y < PROBE_Y + PROBE_DEPTH; y += PROBE_STEP) {
    const element = document.elementFromPoint(x, y);
    if (element?.closest(".centre")) {
      return { element, top: element.getBoundingClientRect().top };
    }
  }
  return null;
}

/** The patch is painted, and then the reading position is put back where it was. */
async function settle(anchor: Anchor): Promise<void> {
  await afterPaint();
  if (anchor === null || !anchor.element.isConnected) return;
  const delta = anchor.element.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) >= ANCHOR_EPSILON) window.scrollBy(0, delta);
}
