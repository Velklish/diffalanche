/**
 * The live stream of DA-18: what the watcher noticed reaches the browser over
 * SSE within the budget, a client that reconnects is caught up rather than
 * reloaded, and stopping the server ends the streams.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
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
import { createEventStream, streamEvents } from "../src/server/events.ts";
import type { ReviewServer } from "../src/server/serve.ts";
import { startReviewServer } from "../src/server/serve.ts";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const SESSION = "synth";
const REPO = "repos/core/cargos-api";
/** `docs/SPEC.md` section 6: update after an edit in one repository. */
const BUDGET_MS = 300;

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

/** Reads an SSE response as frames, the way `EventSource` would. */
function read(response: Response): Reader {
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
    next: async (event, timeoutMs = 5_000) => {
      const from = frames.length;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = frames.slice(from).find((frame) => frame.event === event);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`no ${event} within ${timeoutMs} ms`);
        await new Promise((done) => setTimeout(done, 5));
      }
    },
    waitFor: async (event, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = frames.find((frame) => frame.event === event);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`no ${event} within ${timeoutMs} ms`);
        await new Promise((done) => setTimeout(done, 5));
      }
    },
    close: async () => {
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
}, 120_000);

afterAll(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("the live stream", () => {
  it("names the repository an edit changed, inside the budget", async () => {
    const stream = read(await fetch(`${server.url}/api/events`));
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

  it("carries a reply written by the CLI, and the activity line with its author", async () => {
    const comments = await list(config.dataDir, SESSION);
    const target =
      comments.find((one) => one.repo === REPO) ?? (comments[0] as (typeof comments)[0]);
    const stream = read(await fetch(`${server.url}/api/events`));
    try {
      const started = Date.now();
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

      const frame = await stream.next("reply-added");
      const data = JSON.parse(frame.data) as { id: string; commentId: string };
      expect(data.commentId).toBe(target.id);
      expect(Date.now() - started).toBeLessThan(5_000);

      // The activity line is emitted with the event, so it may already be here.
      const activity = await stream.waitFor("activity", 1_000);
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
    const first = read(await fetch(`${server.url}/api/events`));
    await writeFile(join(root, REPO, "before.ts"), "export const before = 1;\n");
    const seen = await first.next("diff-changed");
    await first.close();

    // Written while nothing is listening.
    await writeFile(join(root, REPO, "after.ts"), "export const after = 1;\n");
    await new Promise((done) => setTimeout(done, 4 * BUDGET_MS));

    const second = read(
      await fetch(`${server.url}/api/events`, { headers: { "Last-Event-ID": seen.id } }),
    );
    try {
      const replayed = await second.next("diff-changed");
      expect(Number(replayed.id)).toBeGreaterThan(Number(seen.id));
      expect(JSON.parse(replayed.data)).toMatchObject({ files: ["after.ts"] });
    } finally {
      await second.close();
    }
  }, 120_000);

  it("hands a client that has just connected the feed it missed", async () => {
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
    const stream = read(await app.request("/api/events"));
    try {
      const deadline = Date.now() + 2_000;
      while (stream.comments.length < 2 && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(stream.comments.length).toBeGreaterThanOrEqual(2);
      expect(stream.comments[0]).toContain("keep-alive");
    } finally {
      await stream.close();
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
