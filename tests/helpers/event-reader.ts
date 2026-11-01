/** The SSE test reader: frames stay in arrival order, and a cursor is taken before a write. */
const DEADLINE_MS = 20_000;
type Frame = { event: string; id: string; data: string; at: number };
export type Reader = {
  frames: Frame[];
  next: (event: string, timeoutMs?: number) => Promise<Frame>;
  waitFor: (event: string, timeoutMs?: number) => Promise<Frame>;
  after: () => (
    event: string,
    matches: (frame: Frame) => boolean,
    timeoutMs?: number,
  ) => Promise<Frame>;
  comments: string[];
  close: () => Promise<void>;
};

/** Reads a live stream as frames, the way `EventSource` would. It makes the request, so `close`
 * aborts it: under Bun a cancelled body leaves the stream subscribed (11-perf.md). */
export async function read(
  url: string,
  init: RequestInit = {},
  request: (url: string, init: RequestInit) => Response | Promise<Response> = fetch,
  overran: (event: string, from: number, timeoutMs: number) => Error = (event, _from, timeoutMs) =>
    new Error(`no ${event} within ${timeoutMs} ms`),
): Promise<Reader> {
  const gone = new AbortController();
  const response = await request(url, { ...init, signal: gone.signal });
  const frames: Frame[] = [];
  const comments: string[] = [];
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end = buffer.indexOf("\n\n");
        while (end !== -1) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (chunk.startsWith(":")) comments.push(chunk);
          else {
            const frame: Frame = { event: "message", id: "", data: "", at: Date.now() };
            for (const line of chunk.split("\n")) {
              const [field, ...rest] = line.split(": ");
              const value = rest.join(": ");
              if (field === "event") frame.event = value;
              if (field === "id") frame.id = value;
              if (field === "data") frame.data = value;
            }
            frames.push(frame);
          }
          end = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // The stream was cancelled or the server stopped: both end the reading.
    }
  })();

  const after = () => {
    const from = frames.length;
    return async (event: string, matches: (frame: Frame) => boolean, timeoutMs = DEADLINE_MS) => {
      const started = Date.now();
      for (;;) {
        const hit = frames.slice(from).find((frame) => frame.event === event && matches(frame));
        if (hit) return hit;
        if (Date.now() > started + timeoutMs) throw overran(event, started, timeoutMs);
        await new Promise((done) => setTimeout(done, 5));
      }
    };
  };
  return {
    after,
    frames,
    comments,
    next: async (event, timeoutMs = DEADLINE_MS) => {
      const from = frames.length;
      const started = Date.now();
      const deadline = started + timeoutMs;
      for (;;) {
        const hit = frames.slice(from).find((frame) => frame.event === event);
        if (hit) return hit;
        if (Date.now() > deadline) throw overran(event, started, timeoutMs);
        await new Promise((done) => setTimeout(done, 5));
      }
    },
    waitFor: async (event, timeoutMs = DEADLINE_MS) => {
      const started = Date.now();
      const deadline = started + timeoutMs;
      for (;;) {
        const hit = frames.find((frame) => frame.event === event);
        if (hit) return hit;
        if (Date.now() > deadline) throw overran(event, started, timeoutMs);
        await new Promise((done) => setTimeout(done, 5));
      }
    },
    close: async () => {
      gone.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
}

/** Matches this write's reply and thread, including a frame that beat the writer's completion. */
export async function writtenReply(
  stream: Reader,
  commentId: string,
  write: () => Promise<string>,
  timeoutMs?: number,
): Promise<Frame> {
  const after = stream.after();
  const id = await write();
  return after(
    "reply-added",
    (frame) => {
      const reply = JSON.parse(frame.data) as { id: string; commentId: string };
      return reply.id === id && reply.commentId === commentId;
    },
    timeoutMs,
  );
}
