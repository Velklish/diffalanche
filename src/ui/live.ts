/** Live update (ADR-005): one `EventSource`, a fetch of what each event names and a patch of the
 * store; reconnecting and `Last-Event-ID` are the browser's own (08-ui.md, "Live update"). */
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

/** What the reader is looking at and where it sat, taken before a patch: putting it back is what
 * keeps the reading position when content above it changes. */
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
  // The task this window is on, so the server knows whose comments to follow: a registry and not
  // a filter, the frames are one broadcast ([07-server.md](../../docs/reference/07-server.md)).
  const source = new EventSource(onTask("/api/events"));

  // One queue: a patch that read the store while another was halfway through it would write
  // back a state that never existed.
  let queue: Promise<void> = Promise.resolve();
  const run = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      // A fetch that failed is a frame lost, not a page lost: the stream is
      // still open and the next event patches over it.
      store().setToast(error instanceof Error ? error.message : String(error));
    });
  };

  // The stream answers with a comment line as soon as it subscribes, so this fires on connect and
  // not with the first heartbeat fifteen seconds later (07-server.md).
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
  // A comment frame names its thread's task and a window drops the others: reading one would answer
  // `no-such-comment` and raise a toast for somebody else's write.
  on<Extract<WatcherEvent, { type: "comment-added" }>>("comment-added", (event) =>
    onScreen(event.session) ? thread(event.id) : undefined,
  );
  on<Extract<WatcherEvent, { type: "reply-added" }>>("reply-added", (event) =>
    onScreen(event.session) ? thread(event.commentId, event.id) : undefined,
  );
  on<Extract<WatcherEvent, { type: "comment-status" }>>("comment-status", (event) =>
    onScreen(event.session) ? thread(event.id) : undefined,
  );
  // A task's metadata changed; only the window showing it re-reads, as megabytes for another task
  // would take the reader's own review away and put it back (ADR-010).
  on<Extract<WatcherEvent, { type: "session-changed" }>>("session-changed", (event) => {
    if (!onScreen(event.name)) return;
    // The page's own base change comes back through the watcher; the review it names is already
    // read, and reading it again would cost megabytes for nothing.
    if (store().claimSelf("review", event.name)) return;
    return store().loadReview();
  });
  // A window with no `?review=` shows and writes where `current` points, so it follows the pointer;
  // a window on a task of its own does not, which is what the address is for (08-ui.md).
  on<Extract<WatcherEvent, { type: "current-changed" }>>("current-changed", (event) => {
    if (store().reviewName !== null) return;
    if (store().claimSelf("review", event.name)) return;
    return store().loadReview();
  });
  // A task appeared, was closed or reopened: news about the history, answered with a mark in the
  // header and nothing else (08-ui.md, "Closing a task, and what the mark in the header is").
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

/** The feed as the server has it, merged by id, so a reconnect's replay of a line it already
 * holds is still one line ([05-watcher.md](../../docs/reference/05-watcher.md)). */
async function readActivity(): Promise<void> {
  const response = await fetch("/api/activity");
  if (!response.ok) return;
  useStore.getState().pushActivity((await response.json()) as ActivityEvent[]);
}

/** One repository's change set as it stands; a 404, `no-such-repository` once it has no changes
 * left, is the repository leaving the review, as much an update as a new diff. */
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
  // The frame that showed the new diff, on the harness's wall clock: the far end of the 300 ms
  // budget of `docs/SPEC.md` section 6.
  perf.liveUpdate = { repo, at: Date.now() };
}

/** One thread, whichever event named it; `replyId` is the reply that arrived, so an agent's answer,
 * and only an agent's, is a toast as well as a line in the rail. */
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

/** The narrowest element at the reading position, and its offset: never the card or section around
 * it, whose top stays put as a card inside grows (08-ui.md, "The reading position…"). */
function capture(): Anchor {
  const centre = document.querySelector(".centre")?.getBoundingClientRect();
  if (!centre) return null;
  const x = centre.left + centre.width / 2;
  // Down from the probe until the topmost element is in the scrolling column: the header, warnings
  // and repository bars do not move when a card grows, so they anchor nothing (DA-54).
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
