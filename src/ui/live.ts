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
import { PROBE_Y } from "./reveal.ts";
import { onTask, refusal, useStore } from "./store.ts";
import type { Comment } from "./types.ts";

/** A shift smaller than this is not worth a scroll: a sub-pixel jitter is not a jump. */
const ANCHOR_EPSILON = 1;

/** How many frames the anchor is watched for; one is what missed a late commit. */
const SETTLE_FRAMES = 4;

/** How many corrections the record keeps; the harness reads a handful. */
const SETTLES_KEPT = 200;

/** How far below the probe the search for the reading column goes, and by how much. */
const PROBE_DEPTH = 240;
const PROBE_STEP = 12;

/**
 * What the reader is looking at and where it sat, taken before a patch is
 * applied. Content that changes above it moves it down the page; putting it
 * back where it was is what keeps the reading position through an agent's edit.
 */
type Anchor = { element: Element; top: number; scrollY: number } | null;

export function startLive(): () => void {
  let stop = connect(false);
  // A stream keeps the address it was made with: a task switch needs a new one, and so does the
  // footer's `reconnect` for a stream the browser gave up on.
  const unsubscribe = useStore.subscribe((state, before) => {
    const asked = state.reconnects !== before.reconnects;
    if (state.reviewName === before.reviewName && !asked) return;
    stop();
    stop = connect(asked);
  });
  return () => {
    unsubscribe();
    stop();
  };
}

/** `behind`: the page missed frames while it had no stream, and a new one has no `Last-Event-ID`
 * to replay them by, so the review is read again once it is open (08-ui.md, DA-96.1). */
function connect(behind: boolean): () => void {
  const store = () => useStore.getState();
  // The task this window is on, so the server knows whose comments to follow.
  // A **registry and not a filter**: the frames are still one broadcast on one
  // sequence of ids ([07-server.md](../../docs/reference/07-server.md)).
  const source = new EventSource(onTask("/api/events"));

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
  let missed = behind;
  source.onopen = () => {
    store().setConnection("watching");
    run(readActivity);
    if (missed) run(() => store().loadReview());
    missed = false;
  };
  // `EventSource` reconnects on its own; the state says so while it does, and
  // says it has stopped once the browser gives up: no frame will come again.
  source.onerror = () => {
    store().setConnection(
      source.readyState === EventSource.CLOSED ? "disconnected" : "reconnecting",
    );
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
  // The three comment frames name the task their thread belongs to, and the
  // stream is one broadcast, so a window drops what is not its own: reading it
  // would answer `no-such-comment` and put a toast up for somebody else's write.
  on<Extract<WatcherEvent, { type: "comment-added" }>>("comment-added", (event) =>
    onScreen(event.session) ? thread(event.id) : undefined,
  );
  on<Extract<WatcherEvent, { type: "reply-added" }>>("reply-added", (event) =>
    onScreen(event.session) ? thread(event.commentId, event.id) : undefined,
  );
  on<Extract<WatcherEvent, { type: "comment-status" }>>("comment-status", (event) =>
    onScreen(event.session) ? thread(event.id) : undefined,
  );
  // The metadata of a task changed — its base, scope, title or status. Only the
  // window showing that task cares: re-reading megabytes for another task's
  // change would take the reader's own away and put it back
  // ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
  on<Extract<WatcherEvent, { type: "session-changed" }>>("session-changed", (event) => {
    if (!onScreen(event.name)) return;
    // The page's own base change comes back through the watcher like anyone
    // else's. It has already read the review it names, and reading it again
    // would cost megabytes for nothing.
    if (store().claimSelf("review", event.name)) return;
    return store().loadReview();
  });
  // `current` moved. A window with no `?review=` shows whatever `current` is and
  // writes there too, so it has to follow the pointer or it would show one task
  // and write into another ([08-ui.md](../../docs/reference/08-ui.md)). A window
  // opened on a task of its own does not follow: that is the whole point of the
  // address.
  on<Extract<WatcherEvent, { type: "current-changed" }>>("current-changed", (event) => {
    if (store().reviewName !== null) return;
    if (store().claimSelf("review", event.name)) return;
    return store().loadReview();
  });
  // A task appeared in the data directory, or one was closed or reopened —
  // whichever session it is, current or not. It is the one frame that is news
  // about the *history* rather than about this review, and it is answered with
  // a mark in the header and nothing else: no toast, no switch, nothing that
  // moves the reading position or takes an open composer away. The reader goes
  // on reading and opens the task when they are ready
  // ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
  on<Extract<WatcherEvent, { type: "sessions-changed" }>>("sessions-changed", (event) => {
    store().noteHistory(event.name);
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

/** Whether a frame is about the review this window is showing. Before the first
 * read nothing is on screen, and nothing is dropped. */
function onScreen(session: string): boolean {
  const shown = useStore.getState().session?.name ?? null;
  return shown === null || shown === session;
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
  // Stamped at request time: what the window is on when the answer lands may
  // not be what it was on when the question went out.
  const asked = useStore.getState().session?.name ?? null;
  const response = await fetch(onTask(`/api/repos/${repo}/diff`));
  if (!response.ok && response.status !== 404) {
    throw new Error(`the diff of ${repo} could not be read: ${(await refusal(response)).message}`);
  }
  const next = response.ok ? ((await response.json()) as RepositoryChange) : null;
  if (asked === null) return;
  const anchor = capture();
  useStore.getState().applyRepositoryDiff(repo, next, asked);
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
  const response = await fetch(onTask(`/api/comments/${id}`));
  if (!response.ok) {
    throw new Error(`the thread ${id} could not be read: ${(await refusal(response)).message}`);
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
  // that scrolls. The header is sticky, the scanner's warnings bar sits under
  // it at the top of the page, and the repository bar is stuck below both and
  // is itself inside `.centre`: none of the three moves when a card grows, so
  // an anchor on one of them is an anchor on nothing. The probe starts below
  // all of them (DA-54).
  for (let y = PROBE_Y; y < PROBE_Y + PROBE_DEPTH; y += PROBE_STEP) {
    const element = document.elementFromPoint(x, y);
    if (element?.closest(".centre")) {
      return { element, top: element.getBoundingClientRect().top, scrollY: window.scrollY };
    }
  }
  return null;
}

/** The reading position, put back once the patch is really on the page and not
 * merely a frame later ([08-ui.md](../../docs/reference/08-ui.md), DA-55.4). */
async function settle(anchor: Anchor): Promise<void> {
  const heightBefore = document.documentElement.scrollHeight;
  let heightAtMeasure = heightBefore;
  let heightAtEnd = heightBefore;
  let corrected = false;
  let delta: number | null = null;

  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) {
    await afterPaint();
    const height = document.documentElement.scrollHeight;
    heightAtEnd = height;
    if (frame === 0) heightAtMeasure = height;
    if (anchor === null || !anchor.element.isConnected) break;
    // The reader scrolled while this was waiting. Their scroll is not the
    // patch's, and taking it back out would be the page fighting them.
    if (window.scrollY !== anchor.scrollY) break;
    const moved = anchor.element.getBoundingClientRect().top - anchor.top;
    delta = moved;
    if (Math.abs(moved) >= ANCHOR_EPSILON) {
      window.scrollBy(0, moved);
      corrected = true;
      break;
    }
    // Nothing moved: either the patch landed above nothing, or it has not
    // landed — and the page's own height is what tells the two apart.
    if (height !== heightBefore) break;
  }
  record({ delta, heightBefore, heightAtMeasure, heightAtEnd, corrected });
}

/** The record DA-55.4 asks for; `grewAfter` counts from where the loop stopped,
 * so it is the growth `settle()` never saw ([08-ui.md](../../docs/reference/08-ui.md)). */
function record(of: {
  delta: number | null;
  heightBefore: number;
  heightAtMeasure: number;
  heightAtEnd: number;
  corrected: boolean;
}): void {
  if (perf.settles.length >= SETTLES_KEPT) return;
  void afterPaint().then(() => {
    const heightAfter = document.documentElement.scrollHeight;
    perf.settles.push({ ...of, heightAfter, grewAfter: heightAfter - of.heightAtEnd });
  });
}
