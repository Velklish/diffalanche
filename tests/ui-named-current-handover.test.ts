import { afterEach, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import type { Comment, Review } from "../src/ui/types.ts";
import { FakeSource } from "./helpers/event-source.ts";

const review = (name: string): Review => ({
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
});
const comment: Comment = {
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
  body: "new destination event",
  createdAt: "2026-01-01",
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
};
const documentFor = (name: string) =>
  new Response(
    JSON.stringify({
      root: "/root",
      repositories: [],
      session: review(name),
      comments: [],
      warnings: [],
      counters: {
        counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
        repositories: [],
      },
    }),
  );
afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ session: null, reviewName: null, comments: [], toast: null });
});
for (const kind of ["comment-added", "reply-added", "comment-status"] as const) {
  for (const mode of ["current-B", "named-B", "unchanged-A"] as const) {
    it(`accepts queued destination frame after named A to ${mode} document completes${kind === "comment-added" ? "" : ` (${kind})`}`, async () => {
      useStore.setState({ session: review("A"), reviewName: "A", comments: [], toast: null });
      vi.stubGlobal("EventSource", FakeSource);
      vi.stubGlobal("document", {
        querySelector: () => null,
        documentElement: { scrollHeight: 0 },
      });
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
      let answerDocument: (value: Response) => void = () => {};
      let answerActivity: (value: Response) => void = () => {};
      const target = mode === "unchanged-A" ? "A" : "B";
      const fetcher = vi.fn((url: string) => {
        if (url.startsWith("/api/review"))
          return new Promise<Response>((resolve) => {
            answerDocument = resolve;
          });
        if (url === "/api/activity")
          return new Promise<Response>((resolve) => {
            answerActivity = resolve;
          });
        if (url === "/api/config")
          return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
        if (url.startsWith("/api/comments/c_new"))
          return Promise.resolve(new Response(JSON.stringify(comment)));
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal("fetch", fetcher);
      const stop = startLive();
      try {
        const showing = useStore.getState().showTask(mode === "current-B" ? null : target);
        const source = FakeSource.last;
        if (source === null) throw new Error("stream missing");
        source.onopen?.();
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/activity"));
        source.deliver(kind, {
          type: kind,
          session: target,
          id: kind === "reply-added" ? "r_new" : "c_new",
          commentId: "c_new",
        });
        expect(fetcher.mock.calls.filter(([url]) => url.startsWith("/api/comments/"))).toHaveLength(
          0,
        );
        answerDocument(documentFor(target));
        await showing;
        expect(useStore.getState().session?.name).toBe(target);
        expect(useStore.getState().comments).toEqual([]);
        answerActivity(new Response("[]"));
        await vi.waitFor(
          () => expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c_new"]),
          { timeout: 250, interval: 10 },
        );
        expect(useStore.getState().counters.counters.open).toBe(1);
        expect(useStore.getState().toast).toBeNull();
      } finally {
        stop();
      }
    });
  }
}

it("finishes an unknown same-task handover before a later unannounced switch", async () => {
  useStore.setState({ session: review("A"), reviewName: "A", comments: [], toast: null });
  vi.stubGlobal("EventSource", FakeSource);
  let threadAnswer: (response: Response) => void = () => {};
  let documentReads = 0;
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/review") {
      documentReads += 1;
      return Promise.resolve(documentFor(documentReads === 1 ? "A" : "B"));
    }
    if (url === "/api/config")
      return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
    if (url === "/api/comments/c_new")
      return new Promise<Response>((resolve) => {
        threadAnswer = resolve;
      });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const stop = startLive();
  try {
    await useStore.getState().showTask(null);
    expect(useStore.getState().session?.name).toBe("A");
    const source = FakeSource.last;
    if (source === null) throw new Error("stream missing");
    source.deliver("comment-added", { type: "comment-added", session: "A", id: "c_new" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/comments/c_new"));
    await useStore.getState().loadReview();
    expect(useStore.getState().session?.name).toBe("B");
    threadAnswer(new Response(JSON.stringify({ message: "stale error" }), { status: 500 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useStore.getState().comments).toEqual([]);
    expect(useStore.getState().toast).toBeNull();
  } finally {
    stop();
  }
});

it("ignores an older unknown-current document after a later named switch", async () => {
  useStore.setState({ session: review("A"), reviewName: "A", comments: [], toast: null });
  vi.stubGlobal("EventSource", FakeSource);
  let oldAnswer: (response: Response) => void = () => {};
  let namedAnswer: (response: Response) => void = () => {};
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/review")
      return new Promise<Response>((resolve) => {
        oldAnswer = resolve;
      });
    if (url === "/api/review?review=C")
      return new Promise<Response>((resolve) => {
        namedAnswer = resolve;
      });
    if (url === "/api/config")
      return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const stop = startLive();
  try {
    const old = useStore.getState().showTask(null);
    const newer = useStore.getState().showTask("C");
    namedAnswer(documentFor("C"));
    await newer;
    const revision = useStore.getState().documentRevision;
    oldAnswer(documentFor("B"));
    await old;
    expect(useStore.getState().reviewName).toBe("C");
    expect(useStore.getState().session?.name).toBe("C");
    expect(useStore.getState().documentRevision).toBe(revision);
  } finally {
    stop();
  }
});

it("does not advance the document revision on a refused current read", async () => {
  useStore.setState({ session: review("A"), reviewName: "A", comments: [], toast: null });
  vi.stubGlobal("EventSource", FakeSource);
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/review")
      return Promise.resolve(
        new Response(JSON.stringify({ message: "review refused" }), { status: 500 }),
      );
    if (url === "/api/review?review=C") return Promise.resolve(documentFor("C"));
    if (url === "/api/config")
      return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const stop = startLive();
  try {
    const revision = useStore.getState().documentRevision;
    await useStore.getState().showTask(null);
    expect(useStore.getState().status).toBe("failed");
    expect(useStore.getState().documentRevision).toBe(revision);
    await useStore.getState().showTask("C");
    expect(useStore.getState().session?.name).toBe("C");
    expect(useStore.getState().documentRevision).toBe(revision + 1);
  } finally {
    stop();
  }
});
