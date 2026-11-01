import { afterEach, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import type { Comment } from "../src/ui/types.ts";
import { FakeSource } from "./helpers/event-source.ts";

const comment = (id: string): Comment => ({
  id,
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
  body: id,
  createdAt: "2026-01-01",
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
});
afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ session: null, reviewName: null });
});
for (const kind of ["comment-added", "reply-added", "comment-status"] as const) {
  for (const switching of [true, false]) {
    it(`queued A thread with ${switching ? "current change to B" : "no task switch"}${kind === "comment-added" ? "" : ` (${kind})`}`, async () => {
      let pointer = "A";
      let answer: (response: Response) => void = () => {};
      useStore.setState({
        session: { name: "A" } as never,
        reviewName: null,
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
      const fetcher = vi.fn((url: string) => {
        if (url === "/api/comments/c_one")
          return new Promise<Response>((resolve) => {
            answer = resolve;
          });
        if (url === "/api/comments/c_two")
          return Promise.resolve(
            new Response(
              JSON.stringify(
                pointer === "B"
                  ? { code: "no-such-comment", message: "c_two belongs to A, current is B" }
                  : comment("c_two"),
              ),
              { status: pointer === "B" ? 404 : 200 },
            ),
          );
        if (url === "/api/review")
          return Promise.resolve(
            new Response(
              JSON.stringify({
                root: "/root",
                repositories: [],
                session: { name: pointer },
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
        if (url === "/api/config")
          return Promise.resolve(new Response(JSON.stringify({ user: "human" })));
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal("fetch", fetcher);
      const stop = startLive();
      try {
        const stream = FakeSource.last as FakeSource;
        stream.deliver(kind, {
          type: kind,
          session: "A",
          id: kind === "reply-added" ? "r_one" : "c_one",
          commentId: "c_one",
        });
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        stream.deliver(kind, {
          type: kind,
          session: "A",
          id: kind === "reply-added" ? "r_two" : "c_two",
          commentId: "c_two",
        });
        expect(fetcher).toHaveBeenCalledTimes(1);
        if (switching) {
          pointer = "B";
          stream.deliver("current-changed", { type: "current-changed", name: "B" });
        }
        answer(new Response(JSON.stringify(comment("c_one"))));
        if (switching) await vi.waitFor(() => expect(useStore.getState().session?.name).toBe("B"));
        else await vi.waitFor(() => expect(useStore.getState().comments).toHaveLength(2));
        const state = useStore.getState();
        expect(state.toast).toBeNull();
        if (switching) {
          expect(state.comments).toEqual([]);
          expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("/api/comments/c_two");
        } else expect(state.comments.map((c) => c.id)).toEqual(["c_one", "c_two"]);
      } finally {
        stop();
      }
    });
  }
}
