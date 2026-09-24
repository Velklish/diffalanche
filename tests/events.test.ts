/**
 * The live stream of DA-18: what the watcher noticed reaches the browser over
 * SSE within the budget, a client that reconnects is caught up rather than
 * reloaded, and stopping the server ends the streams.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { list } from "../src/core/domain/index.ts";
import type { RepositoryChange, ScanWarning } from "../src/core/types.ts";
import { createEventStream, HEARTBEAT_MS, streamEvents } from "../src/server/events.ts";
import type { ReviewServer } from "../src/server/serve.ts";
import { startReviewServer } from "../src/server/serve.ts";
import { needsTypeScript } from "./helpers/typescript.ts";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const SESSION = "synth";
const REPO = "repos/core/cargos-api";
/** How long a frame is waited for: a deadline on a frame that never comes, not a budget — one that
 * arrives late on a loaded machine has still arrived (11-perf.md, "Waits"). */
const DEADLINE_MS = 20_000;

/**
 * Bun's own test runner leaves `fs.watch` quiet after its first events, while a
 * real server under Bun keeps reporting (`docs/reference/05-watcher.md`), so
 * the walk is what these tests run on there.
 */
const NATIVE_WATCH = process.env.DIFFALANCHE_TEST_RUNTIME !== "bun";

let root: string;
let config: Config;
let server: ReviewServer;

/** One frame as it arrived: `event`, `id`, and the data still unparsed. */
type Frame = { event: string; id: string; data: string };

type Reader = {
  frames: Frame[];
  /** Waits for the first frame of a name that arrives after this call. */
  next: (event: string, timeoutMs?: number) => Promise<Frame>;
  /** Waits for a frame of that name, one that already arrived included. */
  waitFor: (event: string, timeoutMs?: number) => Promise<Frame>;
  /** Every comment line, the heartbeat among them. */
  comments: string[];
  close: () => Promise<void>;
};

/** Reads a live stream as frames, the way `EventSource` would. It makes the request, so `close`
 * aborts it: under Bun a cancelled body leaves the stream subscribed (11-perf.md). */
async function read(
  url: string,
  init: RequestInit = {},
  request: (url: string, init: RequestInit) => Response | Promise<Response> = fetch,
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
            const frame: Frame = { event: "message", id: "", data: "" };
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

  return {
    frames,
    comments,
    next: async (event, timeoutMs = DEADLINE_MS) => {
      const from = frames.length;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = frames.slice(from).find((frame) => frame.event === event);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`no ${event} within ${timeoutMs} ms`);
        await new Promise((done) => setTimeout(done, 5));
      }
    },
    waitFor: async (event, timeoutMs = DEADLINE_MS) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = frames.find((frame) => frame.event === event);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`no ${event} within ${timeoutMs} ms`);
        await new Promise((done) => setTimeout(done, 5));
      }
    },
    close: async () => {
      gone.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-events-"));
  generate({ out: root, seed: 17, profile: PROFILES.small });
  config = await loadConfig({ root });
  server = await startReviewServer({
    config: { ...config, port: 0 },
    ...(NATIVE_WATCH ? {} : { recursive: false }),
  });
  await arm();
}, 120_000);

/** Proves the watch of `REPO` delivers before a test writes into it: on the native path a write
 * made before the OS delivers is lost, not late, so it is repeated (`tests/watcher.test.ts`). */
async function arm(): Promise<void> {
  const stream = await read(`${server.url}/api/events`);
  const file = join(root, REPO, "armed.ts");
  try {
    for (let attempt = 0; ; attempt += 1) {
      await writeFile(file, `export const armed = ${attempt};\n`);
      const heard = await stream.next("diff-changed", 2_000).catch(() => null);
      if (heard !== null) break;
      if (attempt >= 15) throw new Error(`the watch of ${REPO} never armed`);
    }
    // Its removal is a change of its own, and the document leaves the file in the callback that
    // sends the frame: waited for there, since an attempt's late frame could pass for it.
    await rm(file, { force: true });
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
      const diff = (await (
        await fetch(`${server.url}/api/repos/${REPO}/diff`)
      ).json()) as RepositoryChange;
      if (!diff.files.some((one) => one.path === "armed.ts")) break;
      if (Date.now() > deadline) throw new Error("the arming file never left the review");
      await new Promise((done) => setTimeout(done, 10));
    }
  } finally {
    await stream.close();
  }
}

afterAll(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the live stream", () => {
  /**
   * The head of a response is not on the wire until something is written into
   * the body, so a stream that says nothing until its first heartbeat leaves a
   * client unable to tell a connection that is up from one that is still being
   * made — fifteen seconds of it (DA-25.1). This is measured over a socket and
   * not through `app.request`, because it is the socket that buffers.
   */
  it("answers as soon as it is subscribed, without waiting for a heartbeat", async () => {
    const started = Date.now();
    const response = await fetch(`${server.url}/api/events`);
    const head = Date.now() - started;
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    try {
      const first = new TextDecoder().decode((await reader.read()).value);
      // The defect is a head held until the first heartbeat: its first bytes would be a keep-alive,
      // at `HEARTBEAT_MS`. Both are its own marks, and neither moves with the machine's load.
      expect(first).toContain("connected");
      expect(first).not.toContain("keep-alive");
      expect(head).toBeLessThan(HEARTBEAT_MS);
    } finally {
      await reader.cancel();
    }
  });

  it("names the repository an edit changed, inside the budget", async () => {
    const stream = await read(`${server.url}/api/events`);
    try {
      const started = Date.now();
      await writeFile(join(root, REPO, "streamed.ts"), "export const streamed = 1;\n");
      const frame = await stream.next("diff-changed");
      const first = Date.now() - started;
      const data = JSON.parse(frame.data) as { repo: string; files: string[] };
      expect(data.repo).toBe(REPO);
      expect(data.files).toContain("streamed.ts");
      expect(Number(frame.id)).toBeGreaterThan(0);
      const again = Date.now();
      await writeFile(join(root, REPO, "streamed.ts"), "export const streamed = 2;\n");
      await stream.next("diff-changed");
      process.stderr.write(`edit to diff-changed: ${first} ms, then ${Date.now() - again} ms\n`);

      // What the UI fetches once the event names the repository.
      const diff = (await (
        await fetch(`${server.url}/api/repos/${data.repo}/diff`)
      ).json()) as RepositoryChange;
      expect(diff.files.map((file) => file.path)).toContain("streamed.ts");
      // The response of the review carries no hunks, and neither does this one.
      expect(diff.files.every((file) => file.hunks.length === 0)).toBe(true);
    } finally {
      await stream.close();
    }
  }, 120_000);

  it("carries a reply written by the CLI, and the activity line with its author", async (context) => {
    needsTypeScript(context);
    const comments = await list(config.dataDir, SESSION);
    const target =
      comments.find((one) => one.repo === REPO) ?? (comments[0] as (typeof comments)[0]);
    const stream = await read(`${server.url}/api/events`);
    try {
      await run(process.execPath, [
        cli,
        "reply",
        target.id,
        "--body",
        "fixed in the working tree",
        "--author",
        "claude",
        "--data-dir",
        config.dataDir,
      ]);

      // The clock starts when the CLI has written, not when it was spawned: a
      // Node process under a full parallel suite can take seconds to start, and
      // that is not the watcher's latency. The wait itself is generous for the
      // same reason (DA-31.1).
      const written = Date.now();
      const frame = await stream.next("reply-added");
      const data = JSON.parse(frame.data) as { id: string; commentId: string };
      expect(data.commentId).toBe(target.id);
      // Printed, not held: no budget of `docs/SPEC.md` section 6 is about a comment frame, and the
      // deadline above is what says it came at all.
      process.stderr.write(`reply written to reply-added: ${Date.now() - written} ms\n`);

      // The activity line is emitted with the event, so it may already be here.
      const activity = await stream.waitFor("activity");
      expect(JSON.parse(activity.data)).toMatchObject({
        verb: "replied",
        author: "claude",
        repo: target.repo,
      });

      // And the thread the event names is one fetch away.
      const thread = (await (await fetch(`${server.url}/api/comments/${target.id}`)).json()) as {
        id: string;
        replies: { author: string }[];
      };
      expect(thread.replies.at(-1)?.author).toBe("claude");
    } finally {
      await stream.close();
    }
  }, 120_000);

  it("replays what a client missed while it was away", async () => {
    const first = await read(`${server.url}/api/events`);
    await writeFile(join(root, REPO, "before.ts"), "export const before = 1;\n");
    const seen = await first.next("diff-changed");
    await first.close();

    // Written while nothing is listening. The document is patched in the same callback that puts
    // the frame in the ring, so the file showing in the diff is the proof the frame is there.
    await writeFile(join(root, REPO, "after.ts"), "export const after = 1;\n");
    const deadline = Date.now() + DEADLINE_MS;
    for (;;) {
      const diff = (await (
        await fetch(`${server.url}/api/repos/${REPO}/diff`)
      ).json()) as RepositoryChange;
      if (diff.files.some((file) => file.path === "after.ts")) break;
      if (Date.now() > deadline)
        throw new Error("the edit made while nobody listened never landed");
      await new Promise((done) => setTimeout(done, 10));
    }

    const second = await read(`${server.url}/api/events`, {
      headers: { "Last-Event-ID": seen.id },
    });
    try {
      // Any frame of it, the first one included: the replay is written as the stream opens, and
      // under Bun it can be in before the request's promise has handed the reader back.
      const replayed = await second.waitFor("diff-changed");
      expect(Number(replayed.id)).toBeGreaterThan(Number(seen.id));
      expect(JSON.parse(replayed.data)).toMatchObject({ files: ["after.ts"] });
    } finally {
      await second.close();
    }
  }, 120_000);

  it("stops counting a window among the followed tasks once its reader is closed", async () => {
    const counted = async (open: boolean): Promise<void> => {
      const deadline = Date.now() + DEADLINE_MS;
      while (server.windows().includes(SESSION) !== open) {
        if (Date.now() > deadline) throw new Error(`the server never saw the window ${open}`);
        await new Promise((done) => setTimeout(done, 5));
      }
    };
    const window = await read(`${server.url}/api/events?review=${SESSION}`);
    await counted(true);
    // What a closed tab does to its connection, and what a cancelled body alone does not under Bun.
    await window.close();
    await counted(false);
  });

  it("hands a client that has just connected the feed it missed", async (context) => {
    // It reads the reply the CLI wrote above, so it skips where that one does.
    needsTypeScript(context);
    // The feed lines of everything above: the panel shows them on connect
    // rather than starting empty, and they are the same shape as the frames.
    const feed = (await (await fetch(`${server.url}/api/activity`)).json()) as {
      id: number;
      verb: string;
      author: string | null;
      repo: string | null;
      at: string;
    }[];
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.map((line) => line.id)).toEqual(
      [...feed.map((line) => line.id)].sort((a, b) => a - b),
    );
    expect(feed.some((line) => line.verb === "replied" && line.author === "claude")).toBe(true);
    expect(feed.at(-1)).toMatchObject({ at: expect.any(String) });
  });

  it("answers the warnings and refuses a repository the change set does not have", async () => {
    const warnings = (await (await fetch(`${server.url}/api/warnings`)).json()) as ScanWarning[];
    expect(Array.isArray(warnings)).toBe(true);

    const missing = await fetch(`${server.url}/api/repos/repos/core/not-here/diff`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "no-such-repository" });
  });
});

describe("the stream itself", () => {
  it("keeps a silent connection alive with a comment", async () => {
    const events = createEventStream();
    const app = new Hono();
    app.get("/api/events", streamEvents(events, 20));
    const stream = await read("/api/events", {}, (url, init) => app.request(url, init));
    try {
      const deadline = Date.now() + 2_000;
      while (stream.comments.length < 3 && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      // The first comment is the one the stream opens with; the heartbeats
      // follow it.
      expect(stream.comments[0]).toContain("connected");
      expect(stream.comments.slice(1).every((one) => one.includes("keep-alive"))).toBe(true);
      expect(stream.comments.length).toBeGreaterThanOrEqual(3);
    } finally {
      await stream.close();
    }
  });

  it("names the tasks its windows are on, once each", async () => {
    const events = createEventStream();
    const app = new Hono();
    app.get("/api/events", streamEvents(events, 5_000));
    // Three windows on two tasks, and one on the current session.
    const opened = [
      await app.request("/api/events?review=ls-1"),
      await app.request("/api/events?review=ls-2"),
      await app.request("/api/events?review=ls-1"),
      await app.request("/api/events"),
    ];
    try {
      expect(events.open()).toBe(4);
      // Once each: the set is about tasks, not about how many windows each has,
      // and the window on `current` names no task at all.
      expect([...events.sessions()].sort()).toEqual(["ls-1", "ls-2"]);
    } finally {
      events.close();
      for (const response of opened) await (response.body as ReadableStream).cancel();
    }
  });

  it("ends every open stream when the server stops", async () => {
    const events = createEventStream();
    const app = new Hono();
    app.get("/api/events", streamEvents(events, 5_000));
    const response = await app.request("/api/events");
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    events.emit("session-changed", { type: "session-changed", name: "one" });
    await reader.read();
    expect(events.open()).toBe(1);

    events.close();
    // The stream ends rather than waiting for the next heartbeat.
    const ended = await reader.read();
    expect(ended.done).toBe(true);
    expect(events.open()).toBe(0);
  });

  it("gives a client that reconnects only what it missed", () => {
    const events = createEventStream(3);
    const first = events.emit("warnings", { list: [] });
    events.emit("warnings", { list: [] });
    const last = events.emit("warnings", { list: [] });
    expect(events.since(first.id).frames.map((frame) => frame.id)).toEqual([first.id + 1, last.id]);
    expect(events.since(first.id).reload).toBeNull();
    expect(events.since(last.id).frames).toEqual([]);
  });

  it("tells a client that is further behind than the ring reaches to read the review again", () => {
    const events = createEventStream(3);
    for (let index = 0; index < 5; index += 1) events.emit("warnings", { list: [] });
    // The ring holds 3, 4 and 5; a client that last saw 1 missed 2 as well, and
    // half a replay would leave it with a review it cannot repair.
    const behind = events.since(1);
    expect(behind.frames).toEqual([]);
    expect(behind.reload).toMatchObject({ event: "reload", id: 5 });
    expect(JSON.parse((behind.reload as { data: string }).data)).toMatchObject({ type: "reload" });
    // The oldest frame the ring still has is a replay, not a reload.
    expect(events.since(2).frames.map((frame) => frame.id)).toEqual([3, 4, 5]);
    expect(events.since(2).reload).toBeNull();
    // And a client from a server that has since restarted is ahead of them all.
    expect(events.since(9).reload).not.toBeNull();
  });
});
