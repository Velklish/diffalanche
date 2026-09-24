import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/ui/store.ts";
import {
  AUTO_WAIT_MS,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_QUERY_LIMIT,
  suggestQuery,
} from "../src/ui/suggest.ts";
import type { Severity, SuggestAnswer, Suggestion } from "../src/ui/types.ts";

/** The composer's suggestions and `AUTO` (DA-36, 08-ui.md "Commenting"), on a clock the test
 * drives: the debounce and the pauses are an order the test sets, not a wait on the machine. */

function row(id: string, severity: Severity, body: string): Suggestion {
  return {
    session: "synth",
    id,
    severity,
    severitySource: "manual",
    repo: null,
    path: null,
    line: null,
    body,
    similarity: 0.9,
  };
}

const ROWS = [row("c_a", "critical", "the cache key misses the region"), row("c_b", "nit", "typo")];

function vote(severity: Severity | null): SuggestAnswer {
  return { severity: severity === null ? null : { severity, confidence: 0.8 }, suggestions: ROWS };
}

type Call = { url: string; body: Record<string, unknown> | null };

/** The server: `answer` for every suggestion asked, and the posted comment echoed back. */
function serve(answer: (text: string) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      if (url.startsWith("/api/suggest")) {
        return answer(new URL(url, "http://x").searchParams.get("body") ?? "");
      }
      return new Response(JSON.stringify({ id: "c_new", ...body, replies: [] }), { status: 201 });
    }),
  );
  return calls;
}

/** An answer the test lets go of when it chooses: the request stays out until then. */
function held(): { answer: Promise<Response>; release: (response: Response) => void } {
  let release: (response: Response) => void = () => {};
  const answer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const away = (message: string) => json({ error: "model", message }, 503);
const asked = (calls: Call[]) => calls.filter((call) => call.url.startsWith("/api/suggest"));
const posted = (calls: Call[]) => calls.filter((call) => call.url.startsWith("/api/comments"));
const REVIEW = { repo: null, path: null, side: null, line: null };

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({
    comments: [],
    modelAway: null,
    modelRetry: { at: 0, pause: 0 },
    toast: null,
  });
  useStore.getState().openComposer(REVIEW);
});

afterEach(() => {
  useStore.getState().closeComposer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("suggestions while typing", () => {
  it("asks once typing pauses, for the last text, and not for one without a long word", async () => {
    const calls = serve(() => json(vote("critical")));
    const store = useStore.getState();
    store.setBody("the");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS * 2);
    expect(asked(calls)).toHaveLength(0);

    store.setBody("the cache");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS - 1);
    store.setBody("the cache key");
    expect(useStore.getState().suggest.asking).toBe(true);
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);

    expect(asked(calls).map((call) => call.url)).toEqual([
      `/api/suggest?body=${encodeURIComponent("the cache key")}`,
    ]);
    expect(useStore.getState().suggest).toMatchObject({
      text: "the cache key",
      answer: vote("critical"),
      asking: false,
    });
  });

  it("asks with a query cut to the limit between characters, never inside one", async () => {
    const calls = serve(() => json(vote("nit")));
    // 字 is 9 bytes of query: 1333 of them fit in 12 000, the 1334th does not.
    useStore.getState().setBody("字".repeat(2000));
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    expect(asked(calls)[0]?.url).toBe(`/api/suggest?body=${encodeURIComponent("字".repeat(1333))}`);

    // An emoji is two UTF-16 units and 12 bytes of query: one that would cross the limit is left
    // out whole, and no half of it reaches the query.
    const before = "a".repeat(SUGGEST_QUERY_LIMIT - 4);
    expect(decodeURIComponent(suggestQuery(`${before}😀b`))).toBe(before);
    expect(suggestQuery("x\ud800y")).toBe("x%EF%BF%BDy");
  });

  it("drops an answer for a text the reader has typed past", async () => {
    const first = held();
    serve((text) => (text === "first text" ? first.answer : json(vote("nit"))));
    useStore.getState().setBody("first text");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    useStore.getState().setBody("second text");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    first.release(json(vote("critical")));
    await vi.advanceTimersByTimeAsync(0);

    expect(useStore.getState().suggest).toMatchObject({ text: "second text", answer: vote("nit") });
  });

  it("chooses no row until a key does, then moves round them, and takes the chosen one", async () => {
    serve(() => json(vote("critical")));
    const store = useStore.getState();
    expect(store.moveSuggestion(1)).toBe(false);
    store.setBody("region cache");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    expect(useStore.getState().sugIdx).toBe(-1);

    expect(store.moveSuggestion(1)).toBe(true);
    expect(useStore.getState().sugIdx).toBe(0);
    store.moveSuggestion(1);
    expect(useStore.getState().sugIdx).toBe(1);
    store.moveSuggestion(1);
    expect(useStore.getState().sugIdx).toBe(0);
    store.moveSuggestion(-1);
    store.acceptSuggestion(useStore.getState().sugIdx);
    expect(useStore.getState()).toMatchObject({ body: "typo", sev: "nit" });
  });

  it("says the row a key chose, and nothing when an answer arrives (DA-36.1)", async () => {
    serve(() => json(vote("critical")));
    const store = useStore.getState();
    store.setBody("region cache");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    expect(useStore.getState().said).toBeNull();

    store.moveSuggestion(1);
    const first = useStore.getState().said;
    expect(first?.text).toBe("подсказка 1 из 2 · CRITICAL · the cache key misses the region");
    // Round the two rows and back: the same words, said again as a new saying.
    store.moveSuggestion(1);
    store.moveSuggestion(1);
    expect(useStore.getState().said?.text).toBe(first?.text);
    expect(useStore.getState().said?.seq).not.toBe(first?.seq);

    // A new answer changes the rows and says nothing over the typing; the row it said is gone.
    store.setBody("region cache key");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    expect(useStore.getState()).toMatchObject({ sugIdx: -1, said: null });
  });
});

describe("AUTO at send time", () => {
  it("stores the neighbours' vote as auto, and warning when they have none", async () => {
    for (const [vote_, stored] of [
      ["question", "question"],
      [null, "warning"],
    ] as const) {
      const calls = serve(() => json(vote(vote_)));
      useStore.getState().openComposer(REVIEW);
      expect(useStore.getState().sev).toBe("auto");
      useStore.getState().setBody("region cache key");
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
      await useStore.getState().submitComment();
      expect(posted(calls)[0]?.body).toMatchObject({ severity: stored, severitySource: "auto" });
      // The rows already answered this very text: the send asked nothing more.
      expect(asked(calls)).toHaveLength(1);
    }
  });

  it("asks for the text being sent when the rows answer an older one, and only once", async () => {
    const calls = serve((text) => json(vote(text === "region cache key" ? "critical" : "nit")));
    useStore.getState().setBody("region cache");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    useStore.getState().setBody("region cache key");
    await useStore.getState().submitComment();
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);

    expect(posted(calls)[0]?.body).toMatchObject({ severity: "critical", severitySource: "auto" });
    expect(asked(calls)).toHaveLength(2);
  });

  it("takes the vote of the request already out for the text, and asks nothing more", async () => {
    const out = held();
    const calls = serve(() => out.answer);
    useStore.getState().setBody("region cache key");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    const sending = useStore.getState().submitComment();
    out.release(json(vote("question")));
    await sending;

    expect(asked(calls)).toHaveLength(1);
    expect(posted(calls)[0]?.body).toMatchObject({ severity: "question", severitySource: "auto" });
  });

  it("sends nothing for a form closed while it waited, and leaves the next form alone", async () => {
    const out = held();
    const calls = serve(() => out.answer);
    useStore.getState().setBody("the first finding");
    const sending = useStore.getState().submitComment();
    useStore.getState().closeComposer();
    useStore.getState().openComposer({ repo: "repos/a", path: null, side: null, line: null });
    useStore.getState().setBody("a second draft");
    out.release(json(vote("critical")));
    await sending;
    await vi.advanceTimersByTimeAsync(0);

    expect(posted(calls)).toHaveLength(0);
    expect(useStore.getState()).toMatchObject({
      composer: { repo: "repos/a" },
      body: "a second draft",
      sending: false,
    });
  });

  it("keeps the field as it is while its send waits: what is sent is what was on the screen", async () => {
    const out = held();
    const calls = serve(() => out.answer);
    useStore.getState().setBody("the first finding");
    const sending = useStore.getState().submitComment();
    useStore.getState().setBody("the first finding, and more typed while it waited");
    expect(useStore.getState().body).toBe("the first finding");
    out.release(json(vote("critical")));
    await sending;
    expect(posted(calls)[0]?.body).toMatchObject({ body: "the first finding" });
  });

  it("stops waiting for a vote after AUTO_WAIT_MS and sends warning, still auto", async () => {
    const calls = serve(() => held().answer);
    useStore.getState().setBody("region cache key");
    const sending = useStore.getState().submitComment();
    await vi.advanceTimersByTimeAsync(AUTO_WAIT_MS);
    await sending;
    expect(posted(calls)[0]?.body).toMatchObject({ severity: "warning", severitySource: "auto" });
  });

  it("stores a chip the reader pressed as manual", async () => {
    const calls = serve(() => json(vote("critical")));
    useStore.getState().setSeverity("nit");
    useStore.getState().setBody("region cache key");
    await useStore.getState().submitComment();
    expect(posted(calls)[0]?.body).toMatchObject({ severity: "nit", severitySource: "manual" });
  });
});

describe("a model that is away", () => {
  it("holds the pause for a question queued before the 503, and stops showing a question out", async () => {
    const first = held();
    const calls = serve((text) => (text === "first text" ? first.answer : json(vote("nit"))));
    useStore.getState().setBody("first text");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    // Typed on while the first question is out: its own question waits out the debounce.
    useStore.getState().setBody("second text");
    first.release(away("the model is being put in place"));
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);

    expect(asked(calls)).toHaveLength(1);
    expect(useStore.getState()).toMatchObject({
      modelAway: "the model is being put in place",
      suggest: { asking: false, answer: null },
    });
    // Typing inside the pause asks nothing and leaves no question showing either.
    useStore.getState().setBody("third text");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    expect(asked(calls)).toHaveLength(1);
    expect(useStore.getState().suggest.asking).toBe(false);
  });

  it("says the model went away once, and WARNING only when it moved the severity (DA-36.1)", async () => {
    serve(() => away("the model is being put in place"));
    useStore.getState().setSeverity("critical");
    useStore.getState().setBody("region cache key");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    const said = useStore.getState().said;
    expect(said?.text).toBe("the model is being put in place — AUTO недоступен");

    // The next 503, after the pause, finds the model already away: nothing is said again, and the
    // region empties with the rows it spoke of.
    await vi.advanceTimersByTimeAsync(10_000);
    useStore.getState().setBody("region cache key again");
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    expect(useStore.getState().said).toBeNull();
  });

  it("takes AUTO out of reach, asks again after a pause that grows, and gives it back", async () => {
    let answer = away("the model is being put in place");
    const calls = serve(() => answer.clone());
    const type = async (text: string) => {
      useStore.getState().setBody(text);
      await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
    };
    await type("region cache key");
    expect(useStore.getState()).toMatchObject({
      modelAway: "the model is being put in place",
      sev: "warning",
      suggest: { answer: null, failure: "the model is being put in place" },
      said: { text: "the model is being put in place — AUTO недоступен, отправится WARNING" },
    });
    useStore.getState().openComposer(REVIEW);
    expect(useStore.getState().sev).toBe("warning");

    // Inside the first pause of 10 s typing asks nothing; after it, it asks, and a second 503
    // doubles the pause.
    await type("inside the pause");
    expect(asked(calls)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await type("after the first pause");
    expect(asked(calls)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await type("inside the second pause");
    expect(asked(calls)).toHaveLength(2);

    answer = json(vote("critical"));
    await vi.advanceTimersByTimeAsync(10_000);
    await type("the model is back now");
    expect(asked(calls)).toHaveLength(3);
    expect(useStore.getState().modelAway).toBeNull();
    useStore.getState().openComposer(REVIEW);
    expect(useStore.getState().sev).toBe("auto");
  });
});
