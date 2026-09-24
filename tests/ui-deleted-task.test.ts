import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/ui/store.ts";

/** A task deleted while a window is on it, or while a menu still lists it (DA-40.1): the window
 * goes where `current` points, as the window that deleted it does ([08-ui.md], "Deleting a task"). */

const REVIEW = {
  root: "/root",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
  session: {
    version: 1,
    name: "synth",
    title: "",
    base: { mode: "head" },
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
  },
  comments: [],
  counters: {
    counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
    repositories: [],
  },
  warnings: [],
};

const GONE = () =>
  new Response(JSON.stringify({ error: "no-such-session", message: 'no review session "ls-7"' }), {
    status: 404,
  });

/** The server with `ls-7` deleted: its review is refused, `current` still answers. */
function serve(): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      asked.push(url);
      if (url === "/api/review?review=ls-7") return Promise.resolve(GONE());
      if (url === "/api/review") return Promise.resolve(new Response(JSON.stringify(REVIEW)));
      if (url === "/api/sessions")
        return Promise.resolve(new Response(JSON.stringify({ sessions: [] })));
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({
    reviewName: null,
    status: "loading",
    failure: null,
    toast: null,
    switching: false,
  });
});

describe("a task deleted elsewhere", () => {
  it("takes a window on it to current, and says which task went", async () => {
    const asked = serve();
    useStore.setState({
      reviewName: "ls-7",
      session: { ...REVIEW.session, name: "ls-7" } as never,
    });

    await useStore.getState().loadReview();

    expect(useStore.getState()).toMatchObject({ reviewName: null, status: "ready", failure: null });
    expect(useStore.getState().session?.name).toBe("synth");
    expect(useStore.getState().toast?.text).toBe(
      'no review session "ls-7" — окно перешло на current',
    );
    // The menu reads the history again, so the row of the task that went goes too.
    expect(asked).toContain("/api/sessions");
  });

  it("answers a press on its stale row with the screen that names it, not a claimed switch", async () => {
    const asked = serve();
    useStore.setState({ reviewName: null, session: { ...REVIEW.session, name: "other" } as never });

    await useStore.getState().switchSession("ls-7");

    // The failure screen with its way back, as for any name that does not open (08-ui.md).
    expect(useStore.getState()).toMatchObject({
      reviewName: "ls-7",
      status: "failed",
      switching: false,
      toast: null,
    });
    expect(asked).toContain("/api/sessions");
  });

  it("leaves a typed address of a task that never opened on its failure screen", async () => {
    serve();
    useStore.setState({ reviewName: "ls-7", session: null });

    await useStore.getState().loadReview();

    expect(useStore.getState()).toMatchObject({ reviewName: "ls-7", status: "failed" });
  });

  it("is still a failure for a window on current", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(GONE())),
    );

    await useStore.getState().loadReview();

    expect(useStore.getState()).toMatchObject({ status: "failed", reviewName: null });
  });
});
