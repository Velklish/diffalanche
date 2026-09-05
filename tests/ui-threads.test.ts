import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore, withComments } from "../src/ui/store.ts";
import { relativeTime } from "../src/ui/time.ts";
import type { Comment } from "../src/ui/types.ts";

/**
 * What a write on a thread does to the store before, during, and after the
 * server answers (DA-23). The rail is optimistic: the card changes at once and
 * the server's answer replaces it, or the threads the rail had before come back
 * with the refusal in the toast ([08-ui.md](../docs/reference/08-ui.md)).
 */

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c_one",
    repo: "repos/a",
    path: "src/a.ts",
    side: "new",
    line: 41,
    endLine: null,
    anchor: null,
    severity: "warning",
    status: "open",
    author: "kim.p",
    role: "human",
    body: "this is wrong",
    createdAt: "2026-09-05T12:00:00Z",
    resolvedAt: null,
    resolvedBy: null,
    replies: [],
    ...over,
  };
}

/** The store as the review left it, with one open thread on one file. */
function withOneThread(): Comment {
  const thread = comment();
  useStore.setState({ user: "kim.p", busy: {}, toast: null, replyId: null, replyText: "" });
  // `withComments` is what the review and every write go through, so the
  // counters and the per-file index come out the way the page sees them.
  useStore.setState(withComments([thread]));
  return thread;
}

function answers(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a write on a thread", () => {
  it("puts the server's answer in the place of the change it made", async () => {
    withOneThread();
    const resolved = comment({ status: "resolved", resolvedBy: "kim.p" });
    answers(resolved);

    await useStore.getState().setStatus("c_one", "resolved");

    expect(useStore.getState().comments).toEqual([resolved]);
    expect(useStore.getState().counters.counters.open).toBe(0);
    expect(useStore.getState().fileCounts.get("repos/a/src/a.ts")?.open).toBe(0);
    expect(useStore.getState().busy).toEqual({});
  });

  it("puts the threads back and says why when the server refuses", async () => {
    const before = withOneThread();
    answers({ error: "no-such-comment", message: 'no comment "c_one"' }, 404);

    await useStore.getState().setStatus("c_one", "resolved");

    expect(useStore.getState().comments).toEqual([before]);
    expect(useStore.getState().counters.counters.open).toBe(1);
    expect(useStore.getState().toast).toBe('no comment "c_one"');
    expect(useStore.getState().busy).toEqual({});
  });

  it("shows the change while the server is still being asked", async () => {
    withOneThread();
    let answer = (_: Response) => {};
    const waiting = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(waiting));

    const done = useStore.getState().setStatus("c_one", "resolved");
    expect(useStore.getState().busy.c_one).toBe(true);
    expect(useStore.getState().comments[0]?.status).toBe("resolved");

    answer(new Response(JSON.stringify(comment({ status: "resolved" })), { status: 200 }));
    await done;
    expect(useStore.getState().busy).toEqual({});
  });

  it("refuses a second write on the thread that is already being written", async () => {
    withOneThread();
    useStore.setState({ busy: { c_one: true } });
    const fetching = vi.fn();
    vi.stubGlobal("fetch", fetching);

    await useStore.getState().setStatus("c_one", "resolved");

    expect(fetching).not.toHaveBeenCalled();
  });

  it("lets a write on another thread through, and rolls back only its own", async () => {
    const first = comment();
    const second = comment({ id: "c_two", line: 90, body: "and this one too" });
    useStore.setState({ user: "kim.p", busy: {}, toast: null });
    useStore.setState(withComments([first, second]));
    // The first thread's write is still in flight; the second one refuses.
    useStore.setState({ busy: { c_one: true } });
    answers({ error: "no-such-comment", message: 'no comment "c_two"' }, 404);

    await useStore.getState().setStatus("c_two", "resolved");

    expect(useStore.getState().comments).toEqual([first, second]);
    expect(useStore.getState().busy).toEqual({ c_one: true });
    expect(useStore.getState().toast).toBe('no comment "c_two"');
  });

  it("carries the reply on the card before the server has it, signed as the reader", async () => {
    withOneThread();
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        // The card already carries the draft at the moment the request goes out.
        expect(useStore.getState().comments[0]?.replies).toHaveLength(1);
        expect(useStore.getState().comments[0]?.replies[0]?.author).toBe("kim.p");
        return Promise.resolve(
          new Response(
            JSON.stringify(
              comment({
                replies: [
                  {
                    id: "r_1",
                    author: "kim.p",
                    role: "human",
                    body: "fixed?",
                    createdAt: "2026-09-05T12:30:00Z",
                  },
                ],
              }),
            ),
            { status: 201 },
          ),
        );
      }),
    );

    useStore.setState({ replyId: "c_one", replyText: "fixed?" });
    await useStore.getState().sendReply("c_one");

    expect(sent).toEqual({ body: "fixed?" });
    expect(useStore.getState().comments[0]?.replies[0]?.id).toBe("r_1");
    // The field closes only once the reply is really there.
    expect(useStore.getState().replyId).toBeNull();
  });

  it("keeps the reply field open when the server refuses it", async () => {
    withOneThread();
    answers({ error: "invalid-request", message: "body has to be a non-empty string" }, 400);
    useStore.setState({ replyId: "c_one", replyText: "  fixed?  " });

    await useStore.getState().sendReply("c_one");

    expect(useStore.getState().comments[0]?.replies).toHaveLength(0);
    expect(useStore.getState().replyId).toBe("c_one");
    expect(useStore.getState().replyText).toBe("  fixed?  ");
  });
});

describe("relative time", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");

  it("counts in the unit the reader would use", () => {
    expect(relativeTime("2026-09-05T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-09-05T11:48:00Z", now)).toBe("12m ago");
    expect(relativeTime("2026-09-05T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-01T12:00:00Z", now)).toBe("4d ago");
  });

  it("reads a clock that is a little ahead as now, not as the future", () => {
    expect(relativeTime("2026-09-05T12:00:20Z", now)).toBe("just now");
  });

  it("gives back what it was handed when that is not a timestamp", () => {
    expect(relativeTime("whenever", now)).toBe("whenever");
  });
});
