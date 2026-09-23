import { afterEach, describe, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import type { ActivityEvent } from "../src/ui/types.ts";
import { FakeSource } from "./helpers/event-source.ts";

/** The recovery paths of `live.ts` (DA-96), as unit tests: the stub reaches all three, and the
 * browser's own reconnect is not this module's to test — why, in 08-ui.md, UI tests. */

/** The stream started against a `fetch` that answers every read with `answer`. */
function live(answer: () => Promise<Response>) {
  const fetched: string[] = [];
  vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", (url: string) => {
    fetched.push(String(url));
    return answer();
  });
  const stop = startLive();
  return { source: FakeSource.last as FakeSource, fetched, stop };
}

/** A refusal with nothing in it: every read these tests make ends here. */
const REFUSED = () => Promise.resolve(new Response("{}", { status: 404 }));

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({ session: null, reviewName: null, toast: null, events: [] });
});

describe("a reload frame", () => {
  it("reads the review again", async () => {
    const { source, fetched, stop } = live(REFUSED);
    const reviews = () => fetched.filter((url) => url.startsWith("/api/review"));
    try {
      // The page's own first read, which the frame asks for a second time.
      await useStore.getState().loadReview();
      expect(reviews()).toHaveLength(1);

      source.deliver("reload", { reason: "the ring no longer reaches back" });

      await vi.waitFor(() => expect(reviews()).toHaveLength(2));
    } finally {
      stop();
    }
  });
});

describe("an error on the stream", () => {
  it("says reconnecting while the browser is retrying", () => {
    const { source, stop } = live(REFUSED);
    try {
      source.readyState = 1;
      source.onopen?.();
      expect(useStore.getState().connection).toBe("watching");

      // `CONNECTING` again: the browser retries on its own.
      source.readyState = 0;
      source.onerror?.();

      expect(useStore.getState().connection).toBe("reconnecting");
    } finally {
      stop();
    }
  });

  it("leaves the footer as it was once the browser has given up", () => {
    const { source, stop } = live(REFUSED);
    try {
      source.readyState = 1;
      source.onopen?.();

      // Not retried, so not `reconnecting`; what it should say instead is DA-96.1.
      source.readyState = FakeSource.CLOSED;
      source.onerror?.();

      expect(useStore.getState().connection).toBe("watching");
    } finally {
      stop();
    }
  });
});

describe("a frame whose read failed", () => {
  const LINE: ActivityEvent = {
    id: 7,
    verb: "replied",
    author: "claude",
    repo: "repos/a",
    path: "src/a.ts",
    at: "2026-09-23T12:00:00Z",
  };

  it("puts the failure in the toast, and the frame after it is still applied", async () => {
    const { source, stop } = live(() => Promise.reject(new TypeError("fetch failed")));
    try {
      source.deliver("comment-added", { type: "comment-added", session: "ls-1", id: "c_7" });
      source.deliver("activity", LINE);

      await vi.waitFor(() => expect(useStore.getState().events).toEqual([LINE]));
      expect(useStore.getState().toast?.text).toBe("fetch failed");
    } finally {
      stop();
    }
  });
});
