/** The live stream: SSE, because updates flow one way (ADR-005), with a ring of frames for a
 * client that reconnects with `Last-Event-ID` (07-server.md, "The live stream"). */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ActivityEvent, EventBus, WatcherEvent } from "../core/watcher/index.ts";

/** One frame on the wire: the id the client sends back, the name, and its JSON. */
type EventFrame = { id: number; event: string; data: string };

/** How many frames a client can miss and still be caught up rather than reloaded. */
const REPLAY_CAPACITY = 200;

/** The frame instead of a replay the ring can no longer give: "read the review again", the only
 * honest answer once the events that would have caught it up are gone. */
const RELOAD_EVENT = "reload";

/** How often a silent stream says so: anything between browser and server may drop a silent
 * connection, and a comment line costs nothing. */
export const HEARTBEAT_MS = 15_000;

/** The first thing a stream says: a head is not on the wire until the body has bytes, and the
 * page would wait for the first heartbeat to know it is connected (07-server.md, 08-ui.md). */
const HELLO = ": connected\n\n";

/** One open stream. `end` is the server stopping, not the client leaving. */
type Client = {
  send: (frame: EventFrame) => void;
  end: () => void;
  /** The task this window is on, `null` for the current session. A **registry**
   * and not a filter: every client still gets every frame (07-server.md). */
  session: string | null;
};

/** What a reconnecting client is owed: the frames it missed, or the one frame that says to read
 * the review again because the ring cannot reach that far back — never both. */
type Replay = { frames: EventFrame[]; reload: EventFrame | null };

export type EventStream = {
  /** Puts an event on the stream and keeps it for a client that reconnects. */
  emit: (event: string, data: unknown) => EventFrame;
  /** What the client that last saw `id` has missed. */
  since: (id: number) => Replay;
  /** Everything from now on. The returned call stops the subscription. */
  subscribe: (client: Client) => () => void;
  /** How many streams are open; the tests and the shutdown ask. */
  open: () => number;
  /** The distinct tasks open windows are on. Several windows on one task are one
   * entry: the set is about tasks, not about how many windows each has. */
  sessions: () => string[];
  /** Ends every open stream: the server is stopping. */
  close: () => void;
};

/** `left` is told when the last window on a task goes: the stream is what knows (05-watcher.md). */
export function createEventStream(
  capacity: number = REPLAY_CAPACITY,
  left?: (session: string) => void,
): EventStream {
  const ring: EventFrame[] = [];
  const clients = new Set<Client>();
  let nextId = 1;

  return {
    emit(event, data) {
      const frame: EventFrame = { id: nextId, event, data: JSON.stringify(data) };
      nextId += 1;
      ring.push(frame);
      if (ring.length > capacity) ring.splice(0, ring.length - capacity);
      // Over a copy: a client that ends while an event is delivered — a stream
      // the browser just dropped — must not shorten the set under the loop.
      for (const client of [...clients]) client.send(frame);
      return frame;
    },
    since(id) {
      // Caught up from `oldest - 1` to `newest`; an id ahead of the newest is a browser that
      // kept its `Last-Event-ID` across a restart of the server.
      const oldest = ring[0]?.id ?? nextId;
      const newest = ring.at(-1)?.id ?? nextId - 1;
      if (id >= oldest - 1 && id <= newest) {
        return { frames: ring.filter((frame) => frame.id > id), reload: null };
      }
      return {
        frames: [],
        reload: {
          id: newest,
          event: RELOAD_EVENT,
          data: JSON.stringify({
            type: RELOAD_EVENT,
            reason: `the stream reaches back to id ${oldest}`,
          }),
        },
      };
    },
    subscribe(client) {
      clients.add(client);
      return () => {
        // Asked twice, by the abort and by the loop's end; only the first is the window going.
        if (!clients.delete(client) || client.session === null) return;
        if (![...clients].some((one) => one.session === client.session)) left?.(client.session);
      };
    },
    open: () => clients.size,
    sessions: () => [
      ...new Set(
        [...clients].flatMap((client) => (client.session === null ? [] : [client.session])),
      ),
    ],
    close() {
      for (const client of [...clients]) {
        clients.delete(client);
        client.end();
      }
    },
  };
}

/** The bus on the stream: each event under its own name with the whole event as data, `type`
 * included, so a client can listen by name or read them all off one handler. */
export function forwardEvents(bus: EventBus, stream: EventStream): () => void {
  return bus.subscribe((event: WatcherEvent) => {
    stream.emit(event.type, event);
  });
}

/** An activity line goes out as `activity`; its verb is inside the data. */
export function forwardActivity(stream: EventStream): (event: ActivityEvent) => void {
  return (event) => {
    stream.emit("activity", event);
  };
}

/** `GET /api/events`: a reconnecting client gets what it missed before the live frames, a new
 * one the live frames only (07-server.md, "The live stream"). */
export function streamEvents(events: EventStream, heartbeatMs: number = HEARTBEAT_MS) {
  return (c: Context): Response =>
    streamSSE(c, async (stream) => {
      let closed = false;
      let wake: (() => void) | null = null;
      // Writes go in one queue: a frame arriving while a heartbeat is being
      // written must not interleave with it on the wire.
      let queue: Promise<void> = Promise.resolve();
      const write = (task: () => Promise<unknown>): Promise<void> => {
        queue = queue.then(task).then(
          () => undefined,
          () => {
            // The client is gone; the stream ends rather than retrying.
            closed = true;
            wake?.();
          },
        );
        return queue;
      };

      const client: Client = {
        session: c.req.query("review") || null,
        send: (frame) => {
          void write(() =>
            stream.writeSSE({ id: String(frame.id), event: frame.event, data: frame.data }),
          );
        },
        end: () => {
          closed = true;
          wake?.();
          // The client is already gone by every path that ends a stream; a
          // close that rejects must not become an unhandled rejection.
          void stream.close().catch(() => undefined);
        },
      };

      // The ring is read and the client subscribed with nothing awaited between, so no frame
      // falls into the gap or arrives out of order; a new client asks for nothing.
      const seen = lastEventId(c);
      const missed: Replay = seen === null ? { frames: [], reload: null } : events.since(seen);
      const unsubscribe = events.subscribe(client);
      stream.onAbort(() => {
        closed = true;
        wake?.();
        unsubscribe();
      });
      // Before the replay, so the head is flushed the moment the stream opens
      // rather than after however much the client had missed.
      void write(() => stream.write(HELLO));
      if (missed.reload) client.send(missed.reload);
      for (const frame of missed.frames) client.send(frame);

      while (!closed) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, heartbeatMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
        if (closed) break;
        await write(() => stream.write(": keep-alive\n\n"));
      }
      unsubscribe();
    });
}

/** The id the client last saw, or `null` when it has seen none. */
function lastEventId(c: Context): number | null {
  const id = Number.parseInt(c.req.header("Last-Event-ID") ?? "", 10);
  return Number.isInteger(id) && id >= 0 ? id : null;
}
