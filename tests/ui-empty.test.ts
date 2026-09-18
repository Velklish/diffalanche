import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/ui/store.ts";

/**
 * The empty states of DA-27 in the store: which of them a root shows, and what
 * `Create` sends. A root with no session is not a review that failed — the
 * server says so with `no-current-session` — and the screen that offers to make
 * one is what that means ([08-ui.md](../docs/reference/08-ui.md)).
 */

const SCAN = {
  root: "/root",
  repositories: [
    { path: "repos/a", kind: "repo", branch: "main", hasChanges: true, files: 3 },
    { path: "repos/b", kind: "repo", branch: "main", hasChanges: false, files: 0 },
    { path: "repos/a-wt", kind: "worktree", branch: "topic", hasChanges: true, files: 1 },
  ],
  warnings: [],
};

const REVIEW = {
  root: "/root",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
  session: {
    version: 1,
    name: "ls-1",
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

type Call = { url: string; body: unknown };

/** The server as each route answers it, and what the page asked of it. */
function serve(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body === undefined ? null : JSON.parse(init.body) });
      const answer = routes[url];
      return Promise.resolve(answer ? answer() : new Response("{}", { status: 404 }));
    }),
  );
  return calls;
}

function refusal(code: string, status = 404): Response {
  return new Response(JSON.stringify({ error: code, message: `${code} says so` }), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  // `reviewName` and `status` go back too: the store is one module-level
  // instance shared by every test in this file, and a test that left a task
  // name behind would send the next one's requests into that task without
  // saying so (DA-55).
  useStore.setState({
    scan: null,
    scanFailure: null,
    switching: false,
    newName: "",
    newBase: "head",
    reviewName: null,
    status: "loading",
  });
});

describe("a root with no session", () => {
  it("is the first-run screen and not a failure, and asks for the scan", async () => {
    serve({
      "/api/review": () => refusal("no-current-session"),
      "/api/scan": () => new Response(JSON.stringify(SCAN)),
    });

    await useStore.getState().loadReview();

    expect(useStore.getState().status).toBe("no-session");
    expect(useStore.getState().failure).toBeNull();
    expect(useStore.getState().scan?.repositories).toHaveLength(3);
  });

  it("says the scan was refused rather than leaving three dashes to mean it", async () => {
    serve({
      "/api/review": () => refusal("no-current-session"),
      "/api/scan": () => refusal("scan-failed", 500),
    });

    await useStore.getState().loadReview();

    // The screen reads both: no summary to count, and a named reason to show (DA-98).
    expect(useStore.getState().status).toBe("no-session");
    expect(useStore.getState().scan).toBeNull();
    expect(useStore.getState().scanFailure).toBe("scan-failed says so");
  });

  it("clears the refusal when the scan is asked again and answers", async () => {
    serve({ "/api/scan": () => new Response(JSON.stringify(SCAN)) });
    useStore.setState({ scanFailure: "scan-failed says so" });

    await useStore.getState().loadScan();

    expect(useStore.getState().scanFailure).toBeNull();
    expect(useStore.getState().scan?.repositories).toHaveLength(3);
  });

  it("is not what any other refusal means", async () => {
    serve({ "/api/review": () => refusal("storage", 500) });

    await useStore.getState().loadReview();

    expect(useStore.getState().status).toBe("failed");
    expect(useStore.getState().failure).toBe("storage says so");
  });
});

describe("creating the first session", () => {
  it("sends the name and the base, and opens the review it made", async () => {
    const calls = serve({
      "/api/sessions": () => new Response(JSON.stringify(REVIEW.session), { status: 201 }),
      "/api/review": () => new Response(JSON.stringify(REVIEW)),
      "/api/config": () => new Response(JSON.stringify({ user: "kim.p" })),
    });
    useStore.setState({ status: "no-session", newName: " ls-1 ", newBase: "head" });

    await useStore.getState().createSession();

    // The first session of a root becomes `current`: this screen is exactly
    // the state in which there is none to leave alone, and a root the CLI
    // cannot name without `--review` is a root the tool half works in
    // ([ADR-010](../docs/adr/adr-010-review-task-scope.md), decision 7).
    expect(calls[0]).toEqual({
      url: "/api/sessions",
      body: { name: "ls-1", base: "head", use: true },
    });
    expect(calls[1]?.url).toBe("/api/review");
    expect(useStore.getState().status).toBe("ready");
    expect(useStore.getState().session?.name).toBe("ls-1");
    expect(useStore.getState().newName).toBe("");
  });

  it("sends the base in the grammar the CLI and the server share", async () => {
    for (const base of ["head", "branch", "branch:develop", "v0.3.1"]) {
      const calls = serve({
        "/api/sessions": () => new Response(JSON.stringify(REVIEW.session), { status: 201 }),
        "/api/review": () => new Response(JSON.stringify(REVIEW)),
        "/api/config": () => new Response(JSON.stringify({ user: "kim.p" })),
        "/api/sessions?": () => new Response(JSON.stringify({ sessions: [], warnings: [] })),
      });
      useStore.setState({ status: "no-session", newName: "ls-1", newBase: base, switching: false });

      await useStore.getState().createSession();

      expect(calls[0]).toEqual({
        url: "/api/sessions",
        body: { name: "ls-1", base, use: true },
      });
      vi.unstubAllGlobals();
    }
  });

  it("leaves `current` alone once the root has a session, and takes the window there", async () => {
    // Every session but the first: `current` is what a terminal beside this
    // window is on, and only `review use` moves it (ADR-010, decision 7). The
    // window follows the task it made through its own address instead.
    const calls = serve({
      "/api/sessions": () => new Response(JSON.stringify(REVIEW.session), { status: 201 }),
      "/api/review?review=ls-1": () => new Response(JSON.stringify(REVIEW)),
      "/api/config": () => new Response(JSON.stringify({ user: "kim.p" })),
    });
    useStore.setState({ status: "ready", newName: "ls-1", newBase: "head", switching: false });

    await useStore.getState().createSession([{ repo: "repos/a", paths: ["src/a.ts"] }]);

    expect(calls[0]).toEqual({
      url: "/api/sessions",
      body: {
        name: "ls-1",
        base: "head",
        use: false,
        scope: [{ repo: "repos/a", paths: ["src/a.ts"] }],
      },
    });
    expect(useStore.getState().reviewName).toBe("ls-1");
  });

  it("does nothing without a name", async () => {
    const calls = serve({});
    useStore.setState({ newName: "   " });

    await useStore.getState().createSession();

    expect(calls).toEqual([]);
  });

  it("stays on the screen and says why when the server refuses", async () => {
    serve({ "/api/sessions": () => refusal("invalid-request", 400) });
    useStore.setState({ status: "no-session", newName: "ls 1" });

    await useStore.getState().createSession();

    expect(useStore.getState().status).toBe("no-session");
    expect(useStore.getState().toast?.text).toBe("invalid-request says so");
    expect(useStore.getState().switching).toBe(false);
  });
});
