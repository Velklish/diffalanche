/**
 * The live stream ([ADR-005](../../docs/adr/adr-005-live-update.md)): what the
 * watcher noticed, on its way to the browser. Events flow one way — the server
 * pushes, the browser fetches what an event names — so this is SSE and not a
 * socket, and `EventSource` reconnects on its own.
 *
 * Frames are kept in a ring so a client that reconnects with `Last-Event-ID`
 * gets what it missed instead of reloading the review.
 */
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ActivityEvent, EventBus, WatcherEvent } from "../core/watcher/index.ts";

/** One frame on the wire: the id the client sends back, the name, and its JSON. */
export type EventFrame = { id: number; event: string; data: string };

/** How many frames a client can miss and still be caught up rather than reloaded. */
export const REPLAY_CAPACITY = 200;

/**
 * The frame a client gets instead of a replay it can no longer have: it says
 * "read the review again", which is the only honest answer when the events that
 * would have brought it up to date are gone.
 */
export const RELOAD_EVENT = "reload";

/**
 * How often a stream that has nothing to say says so. Anything between the
 * browser and the server may drop a connection that has been silent, and a
 * comment line costs nothing.
 */
export const HEARTBEAT_MS = 15_000;

/**
 * The first thing a stream says, before it has anything to report. A response
 * head is not on the wire until something is written into the body, so without
 * this a client learns that its stream is up only when the first heartbeat
 * arrives — fifteen seconds of a page that is connected and cannot say so
 * ([08-ui.md](../../docs/reference/08-ui.md)). The subscription is made when
 * the request is handled, so nothing is missed in that window; it is the
 * silence that is invisible.
 */
export const HELLO = ": connected\n\n";

/** One open stream. `end` is the server stopping, not the client leaving. */
export type Client = {
  send: (frame: EventFrame) => void;
  end: () => void;
};

/**
 * What a client that reconnects is owed: the frames it missed, or the one frame
 * that tells it to read the review again because the ring cannot reach that far
 * back. Never both.
 */
export type Replay = { frames: EventFrame[]; reload: EventFrame | null };

export type EventStream = {
  /** Puts an event on the stream and keeps it for a client that reconnects. */
  emit: (event: string, data: unknown) => EventFrame;
  /** What the client that last saw `id` has missed. */
  since: (id: number) => Replay;
  /** Everything from now on. The returned call stops the subscription. */
  subscribe: (client: Client) => () => void;
  /** How many streams are open; the tests and the shutdown ask. */
  open: () => number;
  /** Ends every open stream: the server is stopping. */
  close: () => void;
};

export function createEventStream(capacity: number = REPLAY_CAPACITY): EventStream {
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
      // The oldest frame still in the ring, and the newest that was ever sent.
      // A client is caught up when its last id is at least the one before the
      // oldest — and not ahead of the newest, which is what a server that has
      // restarted looks like to a browser that kept its `Last-Event-ID`.
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
        clients.delete(client);
      };
    },
    open: () => clients.size,
    close() {
      for (const client of [...clients]) {
        clients.delete(client);
        client.end();
      }
    },
  };
}

/**
 * The bus on the stream: every event goes out under its own name with the whole
 * event as the data, `type` included, so a client can listen by name or read
 * them all off one handler.
 */
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

/**
 * `GET /api/events`. A client that reconnects sends `Last-Event-ID` and gets
 * what it missed from the ring before the live frames; a client that is new
 * gets the live ones only, because the review it just loaded is the state
 * everything before that id led to.
 */
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
        send: (frame) => {
          void write(() =>
            stream.writeSSE({ id: String(frame.id), event: frame.event, data: frame.data }),
          );
        },
        end: () => {
          closed = true;
          wake?.();
          void stream.close();
        },
      };

      // Reading the ring and subscribing happen with nothing awaited between
      // them, so no frame can fall into the gap or arrive out of order. A
      // client that is new asks for nothing: the review it just loaded is the
      // state everything before this point led to.
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
