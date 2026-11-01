import { afterEach, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import type { Comment, Review } from "../src/ui/types.ts";
import { FakeSource } from "./helpers/event-source.ts";

const review: Review = {
  version: 1,
  name: "B",
  title: null,
  base: { mode: "head" },
  scope: null,
  status: "open",
  closedAt: null,
  closedBy: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const comment: Comment = {
  id: "c_initial",
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
  body: "arrived after initial snapshot",
  createdAt: "2026-01-01",
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
};
const documentFor = () =>
  new Response(
    JSON.stringify({
      root: "/root",
      repositories: [],
      session: review,
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
  for (const named of [false, true]) {
    for (const beforeDocument of [true, false]) {
      it(`initial ${named ? "named" : "current"} accepts frame received ${beforeDocument ? "before" : "after"} document application${kind === "comment-added" ? "" : ` (${kind})`}`, async () => {
        useStore.setState({
          session: null,
          reviewName: named ? "B" : null,
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
        let answerDocument: (response: Response) => void = () => {};
        let answerActivity: (response: Response) => void = () => {};
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
          if (url.startsWith("/api/comments/c_initial"))
            return Promise.resolve(new Response(JSON.stringify(comment)));
          throw new Error(`unexpected fetch ${url}`);
        });
        vi.stubGlobal("fetch", fetcher);
        const loading = useStore.getState().loadReview();
        const stop = startLive();
        try {
          const source = FakeSource.last;
          if (source === null) throw new Error("no stream");
          source.onopen?.();
          await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/activity"));
          const deliver = () => {
            source.deliver(kind, {
              type: kind,
              session: "B",
              id: kind === "reply-added" ? "r_initial" : "c_initial",
              commentId: "c_initial",
            });
          };
          if (beforeDocument) deliver();
          answerDocument(documentFor());
          await loading;
          expect(useStore.getState().session?.name).toBe("B");
          expect(useStore.getState().comments).toEqual([]);
          if (!beforeDocument) deliver();
          answerActivity(new Response("[]"));
          await vi.waitFor(
            () => expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c_initial"]),
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
}

for (const named of [false, true]) {
  it(`initial ${named ? "named" : "current"} preserves pending state after a refused document`, async () => {
    useStore.setState({ session: null, reviewName: named ? "B" : null, comments: [], toast: null });
    vi.stubGlobal("EventSource", FakeSource);
    vi.stubGlobal("document", { querySelector: () => null, documentElement: { scrollHeight: 0 } });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    let answerActivity: (response: Response) => void = () => {};
    let reads = 0;
    const fetcher = vi.fn((url: string) => {
      if (url.startsWith("/api/review")) {
        reads += 1;
        return Promise.resolve(
          reads === 1
            ? new Response(JSON.stringify({ message: "refused" }), { status: 500 })
            : documentFor(),
        );
      }
      if (url === "/api/activity")
        return new Promise<Response>((resolve) => {
          answerActivity = resolve;
        });
      if (url === "/api/config")
        return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
      if (url.startsWith("/api/comments/c_initial"))
        return Promise.resolve(new Response(JSON.stringify(comment)));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const revision = useStore.getState().documentRevision;
    const loading = useStore.getState().loadReview();
    const stop = startLive();
    try {
      const source = FakeSource.last;
      if (source === null) throw new Error("no stream");
      source.onopen?.();
      await loading;
      expect(useStore.getState().status).toBe("failed");
      expect(useStore.getState().documentRevision).toBe(revision);
      source.deliver("comment-added", { type: "comment-added", session: "B", id: "c_initial" });
      await useStore.getState().loadReview();
      expect(useStore.getState().documentRevision).toBe(revision + 1);
      answerActivity(new Response("[]"));
      await vi.waitFor(() =>
        expect(useStore.getState().comments.map((c) => c.id)).toEqual(["c_initial"]),
      );
      expect(useStore.getState().counters.counters.open).toBe(1);
    } finally {
      stop();
    }
  });

  it(`initial ${named ? "named" : "current"} ignores a superseded document during handover`, async () => {
    useStore.setState({ session: null, reviewName: named ? "B" : null, comments: [], toast: null });
    vi.stubGlobal("EventSource", FakeSource);
    let oldAnswer: (response: Response) => void = () => {};
    let reads = 0;
    const fetcher = vi.fn((url: string) => {
      if (url.startsWith("/api/review")) {
        reads += 1;
        return reads === 1
          ? new Promise<Response>((resolve) => {
              oldAnswer = resolve;
            })
          : Promise.resolve(documentFor());
      }
      if (url === "/api/config")
        return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const revision = useStore.getState().documentRevision;
    const old = useStore.getState().loadReview();
    const stop = startLive();
    try {
      await useStore.getState().loadReview();
      expect(useStore.getState().session?.name).toBe("B");
      expect(useStore.getState().documentRevision).toBe(revision + 1);
      oldAnswer(documentFor());
      await old;
      expect(useStore.getState().documentRevision).toBe(revision + 1);
      expect(useStore.getState().session?.name).toBe("B");
    } finally {
      stop();
    }
  });
}
