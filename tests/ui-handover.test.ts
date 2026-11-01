/** Windows keep their own document and history through live handovers. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { countReview } from "../src/core/domain/counters.ts";
import type { ReviewDocument } from "../src/core/types.ts";
import { startLive } from "../src/ui/live.ts";
import { useStore } from "../src/ui/store.ts";
import type { Comment } from "../src/ui/types.ts";
import { FakeSource } from "./helpers/event-source.ts";

function comment(): Comment {
  return {
    id: "c_after_document",
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
    body: "landed after document read",
    createdAt: "2026-01-01",
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
  };
}

function documentOf(name: string, comments: Comment[] = []): ReviewDocument {
  return {
    root: "/root",
    repositories: [],
    totals: { repositories: 0, files: 0, lines: 0 },
    warnings: [],
    session: { name } as ReviewDocument["session"],
    comments,
    counters: countReview(comments),
  };
}

function globals() {
  vi.stubGlobal("EventSource", FakeSource as unknown as typeof EventSource);
  vi.stubGlobal("document", { querySelector: () => null, documentElement: { scrollHeight: 0 } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  useStore.setState({
    session: null,
    reviewName: null,
    comments: [],
    sessions: [],
    sessionMenuOpen: false,
    selfWrites: new Map(),
    documentToken: null,
  });
});

describe("a window's document and stream", () => {
  it("reads after its stream opens so a followed task's document-to-stream gap is covered without a reconnect loop", async () => {
    globals();
    useStore.setState({
      session: documentOf("A").session,
      reviewName: "A",
      comments: [],
      documentRevision: 0,
    });
    let reads = 0;
    vi.stubGlobal("fetch", (url: string) => {
      if (url.startsWith("/api/review")) {
        reads += 1;
        return Promise.resolve(new Response(JSON.stringify(documentOf("A", [comment()]))));
      }
      return Promise.resolve(new Response(JSON.stringify(url === "/api/activity" ? [] : {})));
    });
    const stop = startLive();
    try {
      const source = FakeSource.last as FakeSource;
      source.onopen?.();
      await vi.waitFor(
        () => expect(useStore.getState().comments.map((one) => one.id)).toContain(comment().id),
        { timeout: 100 },
      );
      expect(reads).toBe(1);
      expect(FakeSource.last).toBe(source);
      expect(source.closed).toBe(false);
    } finally {
      stop();
    }
  });

  it("keeps a new task's write between server read and document apply", async () => {
    globals();
    useStore.setState({
      session: documentOf("A").session,
      reviewName: "A",
      comments: [],
      documentRevision: 0,
    });
    let answer: (response: Response) => void = () => {};
    let reads = 0;
    vi.stubGlobal("fetch", (url: string) => {
      if (url.startsWith("/api/review")) {
        reads += 1;
        if (reads === 1)
          return new Promise<Response>((resolve) => {
            answer = resolve;
          });
        return Promise.resolve(new Response(JSON.stringify(documentOf("B", [comment()]))));
      }
      if (url.startsWith("/api/comments/"))
        return Promise.resolve(new Response(JSON.stringify(comment())));
      return Promise.resolve(new Response(JSON.stringify(url === "/api/activity" ? [] : {})));
    });
    const stop = startLive();
    try {
      useStore.setState({ reviewName: "B" });
      const loading = useStore.getState().loadReview();
      // The server already read this empty document. The write lands before its body is applied.
      const during = FakeSource.last as FakeSource;
      if (!during.closed)
        during.deliver("comment-added", { type: "comment-added", session: "B", id: comment().id });
      answer(new Response(JSON.stringify(documentOf("B"))));
      await loading;
      (FakeSource.last as FakeSource).onopen?.();
      await vi.waitFor(
        () => expect(useStore.getState().comments.map((one) => one.id)).toContain(comment().id),
        { timeout: 100 },
      );
      expect(useStore.getState().session?.name).toBe("B");
      expect(useStore.getState().counters.counters.total).toBe(1);
    } finally {
      stop();
    }
  });
});

function body(name: string, comments: Comment[], token: string): Response {
  return new Response(JSON.stringify(documentOf(name, comments)), {
    headers: { "X-Diffalanche-Document": token },
  });
}

it("binds one document token and never reconnects for later tokens or repeated open", async () => {
  globals();
  useStore.setState({ session: null, reviewName: "B", comments: [], documentToken: null });
  const made: FakeSource[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends FakeSource {
      constructor(url: string) {
        super(url);
        made.push(this);
      }
    },
  );
  let reads = 0;
  vi.stubGlobal("fetch", (url: string) => {
    if (url.startsWith("/api/review")) return Promise.resolve(body("B", [], `token-${++reads}`));
    return Promise.resolve(new Response(JSON.stringify(url === "/api/activity" ? [] : {})));
  });
  const stop = startLive();
  try {
    made[0]?.onopen?.();
    await vi.waitFor(() => expect(made).toHaveLength(2));
    expect(made[1]?.url).toContain("served=token-1");
    made[1]?.onopen?.();
    made[1]?.onopen?.();
    await vi.waitFor(() => expect(reads).toBe(2));
    await useStore.getState().loadReview();
    expect(reads).toBe(3);
    expect(made).toHaveLength(2);
    expect(made[0]?.closed).toBe(true);
    expect(made[1]?.closed).toBe(false);
  } finally {
    stop();
  }
});

for (const held of ["activity", "refetch"] as const) {
  it(`aborts held old ${held} and preserves its queued agent reply once before a fresh document can mask it`, async () => {
    globals();
    useStore.setState({
      session: null,
      reviewName: "B",
      comments: [],
      documentToken: null,
      toast: null,
    });
    const made: FakeSource[] = [];
    vi.stubGlobal(
      "EventSource",
      class extends FakeSource {
        constructor(url: string) {
          super(url);
          made.push(this);
        }
      },
    );
    const thread: Comment = {
      ...comment(),
      replies: [
        { id: "r_own", role: "agent", author: "agent", body: "answer", createdAt: "2026-01-01" },
      ],
    };
    let appAnswer: (response: Response) => void = () => {};
    let freshAnswer: (response: Response) => void = () => {};
    let reads = 0;
    let activities = 0;
    let aborted = 0;
    let heldStarted = false;
    let threads = 0;
    const originalToast = useStore.getState().setToast;
    const toasts = vi.fn(originalToast);
    useStore.setState({ setToast: toasts });
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const waiting = () =>
        new Promise<Response>((_resolve, reject) => {
          heldStarted = true;
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted += 1;
              reject(new DOMException("connection ended", "AbortError"));
            },
            { once: true },
          );
        });
      if (url === "/api/activity") {
        activities += 1;
        return held === "activity" && activities === 1
          ? waiting()
          : Promise.resolve(new Response("[]"));
      }
      if (url.startsWith("/api/review")) {
        reads += 1;
        if (reads === 1)
          return new Promise<Response>((resolve) => {
            appAnswer = resolve;
          });
        if (held === "refetch" && reads === 2) return waiting();
        return new Promise<Response>((resolve) => {
          freshAnswer = resolve;
        });
      }
      if (url.startsWith("/api/comments/")) {
        threads += 1;
        return Promise.resolve(new Response(JSON.stringify(thread)));
      }
      return Promise.resolve(new Response("{}"));
    });
    const manual = useStore.getState().loadReview();
    const stop = startLive();
    try {
      made[0]?.onopen?.();
      await vi.waitFor(() => expect(heldStarted).toBe(true));
      made[0]?.deliver("reply-added", {
        type: "reply-added",
        session: "B",
        id: "r_own",
        commentId: thread.id,
      });
      appAnswer(body("B", [], "app-token"));
      await manual;
      await vi.waitFor(() => expect(made).toHaveLength(2));
      made[1]?.onopen?.();
      await vi.waitFor(() => expect(threads).toBe(1));
      await vi.waitFor(() => expect(useStore.getState().toast?.text).toBe("agent ответил · ревью"));
      expect(useStore.getState().comments.map((one) => one.id)).toEqual([thread.id]);
      expect(useStore.getState().counters.counters.awaiting).toBe(1);
      expect(aborted).toBe(1);
      expect(toasts.mock.calls.filter(([text]) => text === "agent ответил · ревью")).toHaveLength(
        1,
      );
      await vi.waitFor(() => expect(reads).toBe(held === "activity" ? 2 : 3));
      freshAnswer(body("B", [thread], "fresh-token"));
      await vi.waitFor(() => expect(useStore.getState().documentToken).toBe("fresh-token"));
      expect(made).toHaveLength(2);
      expect(useStore.getState().comments).toHaveLength(1);
      expect(toasts.mock.calls.filter(([text]) => text === "agent ответил · ревью")).toHaveLength(
        1,
      );
    } finally {
      stop();
      useStore.setState({ setToast: originalToast });
    }
  });
}

for (const outcome of ["aborted", "failed"] as const) {
  it(`keeps a pending manual document after a newer connection read ${outcome}`, async () => {
    globals();
    useStore.setState({ session: null, reviewName: "B", comments: [], documentToken: null });
    let oldAnswer: (response: Response) => void = () => {};
    let reads = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (!url.startsWith("/api/review")) return Promise.resolve(new Response("{}"));
      reads += 1;
      if (reads === 1)
        return new Promise<Response>((resolve) => {
          oldAnswer = resolve;
        });
      return outcome === "failed"
        ? Promise.resolve(
            new Response(JSON.stringify({ message: "refetch failed" }), { status: 500 }),
          )
        : new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          });
    });
    const manual = useStore.getState().loadReview();
    const gone = new AbortController();
    const refetch = useStore.getState().loadReview(gone.signal);
    if (outcome === "aborted") gone.abort();
    await refetch;
    oldAnswer(body("B", [], "manual-token"));
    await manual;
    expect(useStore.getState().session?.name).toBe("B");
    expect(useStore.getState().status).toBe("ready");
    expect(useStore.getState().documentToken).toBe("manual-token");
  });
}

it("preserves newer manual intent even when it fails", async () => {
  globals();
  useStore.setState({ session: null, reviewName: "B", comments: [], documentToken: null });
  let oldAnswer: (response: Response) => void = () => {};
  let reads = 0;
  vi.stubGlobal("fetch", (url: string) => {
    if (!url.startsWith("/api/review")) return Promise.resolve(new Response("{}"));
    reads += 1;
    return reads === 1
      ? new Promise<Response>((resolve) => {
          oldAnswer = resolve;
        })
      : Promise.resolve(
          new Response(JSON.stringify({ message: "manual failure" }), { status: 500 }),
        );
  });
  const revision = useStore.getState().documentRevision;
  const old = useStore.getState().loadReview();
  await useStore.getState().loadReview();
  oldAnswer(body("B", [], "old-token"));
  await old;
  expect(useStore.getState().status).toBe("failed");
  expect(useStore.getState().session).toBeNull();
  expect(useStore.getState().documentRevision).toBe(revision);
});

for (const empty of [false, true]) {
  it(`rejects an older manual body after a connection applied ${empty ? "no-session" : "a newer document"}`, async () => {
    globals();
    useStore.setState({ session: null, reviewName: null, comments: [], documentToken: null });
    let oldAnswer: (response: Response) => void = () => {};
    let reads = 0;
    vi.stubGlobal("fetch", (url: string) => {
      if (url.startsWith("/api/review")) {
        reads += 1;
        if (reads === 1)
          return new Promise<Response>((resolve) => {
            oldAnswer = resolve;
          });
        return Promise.resolve(
          empty
            ? new Response(JSON.stringify({ error: "no-current-session", message: "none" }), {
                status: 404,
              })
            : body("B", [comment()], "new-token"),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url === "/api/scan" ? { root: "/root", repositories: [], warnings: [] } : {},
          ),
        ),
      );
    });
    const revision = useStore.getState().documentRevision;
    const old = useStore.getState().loadReview();
    await useStore.getState().loadReview(new AbortController().signal);
    oldAnswer(body("A", [], "old-token"));
    await old;
    expect(useStore.getState().status).toBe(empty ? "no-session" : "ready");
    expect(useStore.getState().session?.name ?? null).toBe(empty ? null : "B");
    expect(useStore.getState().documentToken).toBe(empty ? null : "new-token");
    expect(useStore.getState().documentRevision).toBe(revision + (empty ? 0 : 1));
  });
}

for (const current of [false, true]) {
  it(`continues a ${current ? "current" : "named"} destination while an old thread read is held`, async () => {
    globals();
    useStore.setState({
      session: documentOf("A").session,
      reviewName: current ? null : "A",
      comments: [],
      documentToken: null,
      toast: null,
    });
    let oldAnswer: (response: Response) => void = () => {};
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/comments/c_old"))
        return new Promise<Response>((resolve) => {
          oldAnswer = resolve;
        });
      if (url.startsWith("/api/comments/"))
        return Promise.resolve(new Response(JSON.stringify(comment())));
      if (url.startsWith("/api/review"))
        return Promise.resolve(new Response(JSON.stringify(documentOf("B"))));
      return Promise.resolve(new Response(JSON.stringify(url === "/api/activity" ? [] : {})));
    });
    const stop = startLive();
    try {
      (FakeSource.last as FakeSource).deliver("comment-added", {
        type: "comment-added",
        session: "A",
        id: "c_old",
      });
      await vi.waitFor(() => expect(calls.some((url) => url.includes("c_old"))).toBe(true));
      if (current)
        (FakeSource.last as FakeSource).deliver("current-changed", {
          type: "current-changed",
          name: "B",
        });
      else {
        useStore.setState({ reviewName: "B" });
        (FakeSource.last as FakeSource).onopen?.();
      }
      (FakeSource.last as FakeSource).deliver("comment-added", {
        type: "comment-added",
        session: "B",
        id: comment().id,
      });
      await vi.waitFor(() =>
        expect(useStore.getState().comments.map((one) => one.id)).toContain(comment().id),
      );
      expect(useStore.getState().session?.name).toBe("B");
      oldAnswer(new Response(JSON.stringify({ message: "old request failed" }), { status: 500 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(useStore.getState().toast).toBeNull();
      expect(useStore.getState().comments.map((one) => one.id)).toEqual([comment().id]);
    } finally {
      oldAnswer(new Response(JSON.stringify({ message: "old request failed" }), { status: 500 }));
      await vi.waitFor(() =>
        expect(useStore.getState().comments.map((one) => one.id)).toContain(comment().id),
      );
      stop();
    }
  });
}

it("does not strand the token handover behind an independent first-run scan", async () => {
  globals();
  useStore.setState({
    session: null,
    reviewName: null,
    comments: [],
    documentToken: null,
    status: "loading",
    toast: null,
    scan: null,
  });
  const made: FakeSource[] = [];
  vi.stubGlobal(
    "EventSource",
    class extends FakeSource {
      constructor(url: string) {
        super(url);
        made.push(this);
      }
    },
  );
  let scanAnswer: (response: Response) => void = () => {};
  let scanSignal: AbortSignal | null | undefined;
  let reads = 0;
  let threads = 0;
  const thread: Comment = {
    ...comment(),
    replies: [
      { id: "r_own", role: "agent", author: "agent", body: "reply", createdAt: "2026-01-01" },
    ],
  };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url === "/api/activity") return Promise.resolve(new Response("[]"));
    if (url === "/api/scan") {
      scanSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        scanAnswer = resolve;
      });
    }
    if (url.startsWith("/api/review")) {
      reads += 1;
      return Promise.resolve(
        reads === 1
          ? new Response(JSON.stringify({ error: "no-current-session", message: "none" }), {
              status: 404,
            })
          : body("B", [], `token-${reads}`),
      );
    }
    if (url.startsWith("/api/comments/")) {
      threads += 1;
      return Promise.resolve(new Response(JSON.stringify(thread)));
    }
    return Promise.resolve(new Response("{}"));
  });
  const stop = startLive();
  try {
    made[0]?.onopen?.();
    await vi.waitFor(() => expect(useStore.getState().status).toBe("no-session"));
    await useStore.getState().loadReview();
    expect(made).toHaveLength(2);
    made[1]?.onopen?.();
    made[1]?.deliver("reply-added", {
      type: "reply-added",
      session: "B",
      id: "r_own",
      commentId: thread.id,
    });
    await vi.waitFor(() => expect(threads).toBe(1));
    expect(useStore.getState().toast?.text).toBe("agent ответил · ревью");
    expect(useStore.getState().counters.counters.awaiting).toBe(1);
    expect(scanSignal).toBeUndefined();
  } finally {
    scanAnswer(
      new Response(JSON.stringify({ root: "/completed-scan", repositories: [], warnings: [] })),
    );
    await vi.waitFor(() => expect(threads).toBe(1));
    await vi.waitFor(() => expect(useStore.getState().scan?.root).toBe("/completed-scan"));
    expect(useStore.getState().status).toBe("ready");
    expect(useStore.getState().session?.name).toBe("B");
    stop();
  }
});

for (const current of [false, true]) {
  it(`shares the ${current ? "current" : "named"} handover queue with an already received agent reply`, async () => {
    globals();
    useStore.setState({
      session: documentOf("A").session,
      reviewName: current ? null : "A",
      comments: [],
      documentToken: null,
      toast: null,
    });
    const made: FakeSource[] = [];
    vi.stubGlobal(
      "EventSource",
      class extends FakeSource {
        constructor(url: string) {
          super(url);
          made.push(this);
        }
      },
    );
    const thread: Comment = {
      ...comment(),
      replies: [
        { id: "r_own", role: "agent", author: "agent", body: "answer", createdAt: "2026-01-01" },
      ],
    };
    let documentAnswer: (response: Response) => void = () => {};
    let threadAnswer: (response: Response) => void = () => {};
    let freshAnswer: (response: Response) => void = () => {};
    let reads = 0;
    let threads = 0;
    const originalToast = useStore.getState().setToast;
    const toasts = vi.fn(originalToast);
    useStore.setState({ setToast: toasts });
    vi.stubGlobal("fetch", (url: string) => {
      if (url.startsWith("/api/review")) {
        reads += 1;
        return new Promise<Response>((resolve) => {
          if (reads === 1) documentAnswer = resolve;
          else freshAnswer = resolve;
        });
      }
      if (url.startsWith("/api/comments/")) {
        threads += 1;
        return new Promise<Response>((resolve) => {
          threadAnswer = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify(url === "/api/activity" ? [] : {})));
    });
    const loading = useStore.getState().loadReview();
    const stop = startLive();
    try {
      made[0]?.deliver("reply-added", {
        type: "reply-added",
        session: "A",
        id: "r_own",
        commentId: thread.id,
      });
      await vi.waitFor(() => expect(threads).toBe(1));
      documentAnswer(body("A", [], "first-token"));
      await loading;
      expect(made).toHaveLength(2);
      made[1]?.onopen?.();
      // All immediate response microtasks finish before this timer; the held thread must still own the queue.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reads).toBe(1);
      threadAnswer(new Response(JSON.stringify(thread)));
      await vi.waitFor(() => expect(useStore.getState().toast?.text).toBe("agent ответил · ревью"));
      expect(useStore.getState().comments.map((one) => one.id)).toEqual([thread.id]);
      expect(toasts.mock.calls.filter(([text]) => text === "agent ответил · ревью")).toHaveLength(
        1,
      );
      await vi.waitFor(() => expect(reads).toBe(2));
      freshAnswer(body("A", [thread], "later-token"));
      await vi.waitFor(() => expect(useStore.getState().documentToken).toBe("later-token"));
      expect(made).toHaveLength(2);
      expect(threads).toBe(1);
      expect(useStore.getState().counters.counters.awaiting).toBe(1);
      expect(toasts.mock.calls.filter(([text]) => text === "agent ответил · ревью")).toHaveLength(
        1,
      );
    } finally {
      threadAnswer(new Response(JSON.stringify(thread)));
      freshAnswer(body("A", [thread], "cleanup-token"));
      stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
      useStore.setState({ setToast: originalToast });
    }
  });
}
