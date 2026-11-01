import { afterEach, describe, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import { FakeSource } from "./helpers/event-source.ts";

/** Frames that are not this window's (DA-68): one broadcast and one ring per server, so the client
 * drops them by the session a frame carries (07-server.md, "The task a request is about"). */

function live(): { source: FakeSource; fetched: string[]; stop: () => void } {
  const fetched: string[] = [];
  vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", (url: string) => {
    fetched.push(String(url));
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
  const stop = startLive();
  return { source: FakeSource.last as FakeSource, fetched, stop };
}

/** The review on screen, which is what a frame is measured against. */
function showing(name: string): void {
  useStore.setState({ session: { name } as never, reviewName: name });
}

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ session: null, reviewName: null });
});

describe("a comment frame that belongs to another task", () => {
  it("is dropped without a request, and this task's is not", async () => {
    showing("ls-1");
    const { source, fetched, stop } = live();
    try {
      // Another task's thread. Reading it would answer `no-such-comment`, and
      // the queue would turn that 404 into a toast about somebody else's write.
      source.deliver("comment-added", { type: "comment-added", session: "ls-2", id: "c_theirs" });
      source.deliver("reply-added", {
        type: "reply-added",
        session: "ls-2",
        id: "r_theirs",
        commentId: "c_theirs",
      });
      source.deliver("comment-status", {
        type: "comment-status",
        session: "ls-2",
        id: "c_theirs",
      });
      await new Promise((done) => setTimeout(done, 0));
      expect(fetched).toEqual([]);

      // This window's own task is read, which is what the guard must not cost.
      source.deliver("comment-added", { type: "comment-added", session: "ls-1", id: "c_mine" });
      await new Promise((done) => setTimeout(done, 0));
      expect(fetched).toHaveLength(1);
      expect(fetched[0]).toContain("/api/comments/c_mine");
    } finally {
      stop();
    }
  });

  it("follows `current` when the window has no address, and only then", async () => {
    // A window with no `?review=` shows `current` *and writes there*, so it follows the pointer:
    // showing one task while writing into another is the damage (08-ui.md).
    useStore.setState({ session: { name: "ls-1" } as never, reviewName: null });
    const { source, fetched, stop } = live();
    try {
      source.deliver("current-changed", { type: "current-changed", name: "ls-2" });
      await new Promise((done) => setTimeout(done, 0));
      expect(fetched.some((url) => url.includes("/api/review"))).toBe(true);
    } finally {
      stop();
    }
  });

  it("does not follow `current` when the window is on a task of its own", async () => {
    showing("ls-1");
    const { source, fetched, stop } = live();
    try {
      // `current` moving is somebody else's business for this window: that is
      // what the address is for.
      source.deliver("current-changed", { type: "current-changed", name: "ls-2" });
      await new Promise((done) => setTimeout(done, 0));
      expect(fetched).toEqual([]);
    } finally {
      stop();
    }
  });

  it("re-reads on its own task's metadata and not on another task's", async () => {
    // The watcher follows several sessions, so `session-changed` arrives for tasks this window is
    // not on, and rereading megabytes for those is what ADR-010 forbids.
    useStore.setState({ session: { name: "ls-1" } as never, reviewName: null });
    const { source, fetched, stop } = live();
    try {
      source.deliver("session-changed", { type: "session-changed", name: "ls-9" });
      await new Promise((done) => setTimeout(done, 0));
      expect(fetched).toEqual([]);

      source.deliver("session-changed", { type: "session-changed", name: "ls-1" });
      await new Promise((done) => setTimeout(done, 0));
      expect(fetched.some((url) => url.includes("/api/review"))).toBe(true);
    } finally {
      stop();
    }
  });

  it("opens the stream on the task the window is on, and reopens it on a switch", () => {
    showing("ls-1");
    const { source, stop } = live();
    try {
      expect(source.url).toContain("review=ls-1");
      // An open `EventSource` keeps the address it was made with, so the window
      // would go on declaring the task it left and the server would follow it.
      showing("ls-2");
      expect(source.closed).toBe(true);
      expect((FakeSource.last as FakeSource).url).toContain("review=ls-2");
    } finally {
      stop();
    }
  });
});

function liveComment() {
  return {
    id: "c_one",
    repo: null,
    path: null,
    side: null,
    line: null,
    endLine: null,
    anchor: null,
    severity: "warning",
    severitySource: "manual",
    status: "open",
    author: "human",
    role: "human",
    body: "old",
    createdAt: "2026-01-01",
    resolvedAt: null,
    resolvedBy: null,
    replies: [
      { id: "r_one", role: "agent", author: "agent", body: "reply", createdAt: "2026-01-01" },
    ],
  };
}

describe("a thread read across a task switch", () => {
  const frames = ["comment-added", "reply-added", "comment-status"] as const;
  for (const frame of frames) {
    for (const current of [false, true]) {
      for (const back of [false, true]) {
        for (const failed of [false, true]) {
          it(`${frame}: ${current ? "current" : "named"} A → B${back ? " → A" : ""}, ${failed ? "error" : "success"}`, async () => {
            useStore.setState({
              session: { name: "A" } as never,
              reviewName: current ? null : "A",
              comments: [],
              toast: null,
            });
            vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
            vi.stubGlobal("document", {
              querySelector: () => null,
              documentElement: { scrollHeight: 0 },
            });
            vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
              callback(0);
              return 0;
            });
            let answer: (response: Response) => void = () => {};
            const fetcher = vi.fn(
              () =>
                new Promise<Response>((resolve) => {
                  answer = resolve;
                }),
            );
            vi.stubGlobal("fetch", fetcher);
            const stop = startLive();
            try {
              const source = FakeSource.last as FakeSource;
              source.deliver(frame, {
                type: frame,
                session: "A",
                id: frame === "reply-added" ? "r_one" : "c_one",
                commentId: "c_one",
              });
              await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
              useStore.setState({
                session: { name: "B" } as never,
                reviewName: current ? null : "B",
              });
              if (back)
                useStore.setState({
                  session: { name: "A" } as never,
                  reviewName: current ? null : "A",
                });

              answer(
                new Response(JSON.stringify(failed ? { message: "old error" } : liveComment()), {
                  status: failed ? 500 : 200,
                }),
              );
              await new Promise((resolve) => setTimeout(resolve, 20));
              expect(useStore.getState().comments).toEqual([]);
              expect(useStore.getState().toast).toBeNull();
            } finally {
              stop();
            }
          });
        }
      }
    }
  }
});

describe("a current thread read", () => {
  it("invalidates a pending read when current changes before the queued review read", async () => {
    useStore.setState({
      session: { name: "A" } as never,
      reviewName: null,
      comments: [],
      toast: null,
    });
    vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
    let answer: (response: Response) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      )
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const stop = startLive();
    try {
      const source = FakeSource.last as FakeSource;
      source.deliver("reply-added", {
        type: "reply-added",
        session: "A",
        id: "r_one",
        commentId: "c_one",
      });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      source.deliver("current-changed", { type: "current-changed", name: "B" });
      answer(new Response(JSON.stringify(liveComment())));
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      expect(useStore.getState().comments).toEqual([]);
      expect(useStore.getState().toast).toBeNull();
    } finally {
      stop();
    }
  });

  it("keeps valid updates and counters after a same-task refresh, and processes the next frame", async () => {
    useStore.setState({
      session: { name: "A" } as never,
      reviewName: null,
      comments: [],
      toast: null,
    });
    vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
    vi.stubGlobal("document", { querySelector: () => null, documentElement: { scrollHeight: 0 } });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    let answer: (response: Response) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      )
      .mockResolvedValue(new Response(JSON.stringify({ ...liveComment(), status: "resolved" })));
    vi.stubGlobal("fetch", fetcher);
    const stop = startLive();
    try {
      const source = FakeSource.last as FakeSource;
      source.deliver("comment-added", { type: "comment-added", session: "A", id: "c_one" });
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      useStore.setState({ session: { name: "A" } as never });
      source.deliver("comment-status", { type: "comment-status", session: "A", id: "c_one" });
      expect(fetcher).toHaveBeenCalledTimes(1);
      answer(new Response(JSON.stringify(liveComment())));
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(useStore.getState().comments[0]?.status).toBe("resolved"));
      expect(useStore.getState().comments).toHaveLength(1);
      expect(useStore.getState().counters.counters.resolved).toBe(1);
    } finally {
      stop();
    }
  });
});
