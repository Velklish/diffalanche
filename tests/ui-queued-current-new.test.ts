import { afterEach, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import type { Review } from "../src/ui/types.ts";
import { FakeSource } from "./helpers/event-source.ts";

function review(name: string): Review {
  return {
    version: 1,
    name,
    title: null,
    base: { mode: "head" },
    scope: null,
    status: "open",
    closedAt: null,
    closedBy: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

const comment = {
  id: "c_new",
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
  body: "new task event after document snapshot",
  createdAt: "2026-01-01",
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ session: null, reviewName: null, comments: [], toast: null });
});
for (const kind of ["comment-added", "reply-added", "comment-status"] as const) {
  for (const switching of [false, true]) {
    it(`accepts queued ${switching ? "B after current-changed B" : "A after unchanged current A"} while document is held${kind === "comment-added" ? "" : ` (${kind})`}`, async () => {
      const target = switching ? "B" : "A";
      useStore.setState({
        session: review("A"),
        reviewName: null,
        comments: [],
        toast: null,
      });
      vi.stubGlobal("EventSource", FakeSource);
      vi.stubGlobal("document", {
        querySelector: () => null,
        documentElement: { scrollHeight: 0 },
      });
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
      let documentAnswer: (response: Response) => void = () => {};
      const fetcher = vi.fn((url: string) => {
        if (url === "/api/review")
          return new Promise<Response>((resolve) => {
            documentAnswer = resolve;
          });
        if (url === "/api/config")
          return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
        if (url === "/api/comments/c_new")
          return Promise.resolve(new Response(JSON.stringify(comment)));
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal("fetch", fetcher);
      const stop = startLive();
      try {
        const stream = FakeSource.last;
        if (stream === null) throw new Error("stream did not start");
        stream.deliver("current-changed", { type: "current-changed", name: target });
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/review"));
        stream.deliver(kind, {
          type: kind,
          session: target,
          id: kind === "reply-added" ? "r_new" : "c_new",
          commentId: "c_new",
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        documentAnswer(
          new Response(
            JSON.stringify({
              root: "/root",
              repositories: [],
              session: { name: target },
              comments: [],
              warnings: [],
              counters: {
                counters: {
                  total: 0,
                  open: 0,
                  resolved: 0,
                  unanswered: 0,
                  awaiting: 0,
                  severity: null,
                },
                repositories: [],
              },
            }),
          ),
        );
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/config"));
        await vi.waitFor(
          () => expect(useStore.getState().comments.map((one) => one.id)).toEqual(["c_new"]),
          { timeout: 250, interval: 10 },
        );
        expect(useStore.getState().session?.name).toBe(target);
        expect(useStore.getState().counters.counters.open).toBe(1);
        expect(useStore.getState().toast).toBeNull();
      } finally {
        stop();
      }
    });
  }
}

it("keeps the latest current generation through an intermediate document", async () => {
  useStore.setState({
    session: review("A"),
    reviewName: null,
    comments: [],
    toast: null,
  });
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal("document", { querySelector: () => null, documentElement: { scrollHeight: 0 } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  let answerB: (response: Response) => void = () => {};
  let reviewReads = 0;
  const documentFor = (name: string) =>
    new Response(
      JSON.stringify({
        root: "/root",
        repositories: [],
        session: { name },
        comments: [],
        warnings: [],
        counters: {
          counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
          repositories: [],
        },
      }),
    );
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/review") {
      reviewReads += 1;
      return reviewReads === 1
        ? new Promise<Response>((resolve) => {
            answerB = resolve;
          })
        : Promise.resolve(documentFor("A"));
    }
    if (url === "/api/config")
      return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
    if (url === "/api/comments/c_new")
      return Promise.resolve(new Response(JSON.stringify(comment)));
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const stop = startLive();
  try {
    const stream = FakeSource.last;
    if (stream === null) throw new Error("stream did not start");
    stream.deliver("current-changed", { type: "current-changed", name: "B" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/review"));
    stream.deliver("comment-added", { type: "comment-added", session: "B", id: "c_old" });
    stream.deliver("current-changed", { type: "current-changed", name: "A" });
    stream.deliver("comment-added", { type: "comment-added", session: "A", id: "c_new" });
    answerB(documentFor("B"));
    await vi.waitFor(() =>
      expect(useStore.getState().comments.map((one) => one.id)).toEqual(["c_new"]),
    );
    expect(useStore.getState().session?.name).toBe("A");
    expect(useStore.getState().counters.counters.open).toBe(1);
    expect(useStore.getState().toast).toBeNull();
    expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("/api/comments/c_old");
  } finally {
    stop();
  }
});
