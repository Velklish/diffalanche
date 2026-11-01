/** A deletion frame updates an already open menu without changing the window's task. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import { FakeSource } from "./helpers/event-source.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({
    session: null,
    reviewName: null,
    sessions: [],
    sessionMenuOpen: false,
    selfWrites: new Map(),
  });
});

describe("a deleted history row", () => {
  for (const selfMarked of [false, true]) {
    it(`removes a task deleted elsewhere from the open menu with self marker ${selfMarked}`, async () => {
      vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
      vi.stubGlobal("fetch", vi.fn());
      useStore.setState({
        session: { name: "A" } as never,
        reviewName: "A",
        sessionMenuOpen: true,
        sessions: [{ name: "A" }, { name: "B" }] as never,
        historyMark: false,
      });
      if (selfMarked) useStore.getState().markSelf("history", "B");
      const stop = startLive();
      try {
        (FakeSource.last as FakeSource).deliver("sessions-changed", {
          type: "sessions-changed",
          name: "B",
          status: null,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(useStore.getState().sessions.map((one) => one.name)).toEqual(["A"]);
        expect(useStore.getState().session?.name).toBe("A");
        expect(useStore.getState().sessionMenuOpen).toBe(true);
        expect(useStore.getState().historyMark).toBe(false);
      } finally {
        stop();
      }
    });
  }
});
