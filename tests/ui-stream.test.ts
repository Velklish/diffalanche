import { afterEach, describe, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import { FakeSource } from "./helpers/event-source.ts";

/**
 * What the live stream does with a frame that is not this window's (DA-68). The
 * frames are one broadcast — the ring and its ids are one per server — so the
 * dropping is the client's, by the session the frame carries
 * ([07-server.md](../docs/reference/07-server.md)).
 */

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
    // A window with no `?review=` shows whatever `current` is *and writes there*,
    // so it has to follow the pointer: showing one task while writing into
    // another is the damage ([08-ui.md](../docs/reference/08-ui.md)).
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
    // The second frame is the one batch 2 made possible: the watcher follows
    // several sessions, so `session-changed` now arrives for tasks this window
    // is not on, and re-reading megabytes for those is what ADR-010 forbids.
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
