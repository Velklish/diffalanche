/**
 * The server of DA-16: the review in one document, the sessions, the settings,
 * the scan, and the built UI, on `127.0.0.1` and nowhere else.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { findRepositories } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import {
  addComment,
  createSession,
  deleteSession,
  setScope,
  useSession,
} from "../src/core/domain/index.ts";
import type { DiffCache } from "../src/core/storage/index.ts";
import {
  NoSuchSessionError,
  readComments,
  readDiffCache,
  writeComments,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import type { ReviewDocument } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { errorResponse } from "../src/server/errors.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";
import { startReviewServer } from "../src/server/serve.ts";

const SMALL = PROFILES.small;
const SESSION = "synth";
/** A second task, never current: what a window opened on `?review=` is on. */
const NAMED = "named-task";
/** A third, about one repository: what a scope keeps a signal away from. */
const SCOPED = "scoped-task";
/** The repository `SCOPED` is about, and one it is not. */
let inScope = "";
let outOfScope = "";
const PAGE = "<!doctype html><title>diffalanche</title>";

/** The UI as the two delivery channels hand it over: one file, or nothing. */
const ui: UiAssets = {
  read: async (path) =>
    path === "index.html"
      ? { body: new TextEncoder().encode(PAGE), type: "text/html; charset=utf-8" }
      : null,
};
const noUi: UiAssets = { read: async () => null };

/** Bun's own test runner leaves `fs.watch` quiet after its first events, so the walk is what a test
 * that waits for the watcher runs on there (05-watcher.md). */
const NATIVE_WATCH = process.env.DIFFALANCHE_TEST_RUNTIME !== "bun";

/** A live stream read as text as it arrives: enough to ask whether a frame has come. It makes the
 * request, so `close` aborts it: under Bun a cancelled body leaves the window counted (11-perf.md). */
async function listen(url: string): Promise<{
  heard: (event: string) => boolean;
  said: (text: string) => boolean;
  close: () => Promise<void>;
}> {
  const gone = new AbortController();
  const response = await fetch(url, { signal: gone.signal });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      // The stream was cancelled or the server stopped: both end the reading.
    }
  })();
  return {
    heard: (event) => text.includes(`event: ${event}\n`),
    said: (needle) => text.includes(needle),
    close: async () => {
      gone.abort();
      await reader.cancel().catch(() => undefined);
    },
  };
}

/** The config with a flag raised when a build first reads the root, which it does as its scan
 * starts: the sign a build is under way, where a length of time could only guess it. */
function building(of: Config): { config: Config; started: () => Promise<void> } {
  let read = false;
  const config = new Proxy(of, {
    get: (target, key, receiver) => {
      if (key === "root") read = true;
      return Reflect.get(target, key, receiver);
    },
  });
  return {
    config,
    started: async () => {
      const deadline = performance.now() + 20_000;
      while (!read) {
        if (performance.now() > deadline) throw new Error("no build began its scan");
        await new Promise((done) => setTimeout(done, 1));
      }
    },
  };
}

let root: string;
let config: Config;
let app: Hono;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-server-"));
  generate({ out: root, seed: 11, profile: SMALL });
  config = await loadConfig({ root });
  app = createApp({
    activity: createActivityLog(),
    config,
    events: createEventStream(),
    review: createReviewService(config),
    ui,
  });
  // Fixtures rather than the leavings of an earlier test: a file run on its own
  // must fail on its subject, not on `no-such-session`.
  await createSession(config.dataDir, NAMED, { mode: "head" }, undefined, { use: false });
  const repositories = await findRepositories(config);
  inScope = repositories[0] as string;
  outOfScope = repositories[1] as string;
  await createSession(config.dataDir, SCOPED, { mode: "head" }, undefined, {
    use: false,
    scope: [{ repo: inScope, paths: null }],
  });
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the review document", () => {
  it("answers with the change set, the session, the comments and the counters at once", async () => {
    const response = await app.request("/api/review");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const document = (await response.json()) as ReviewDocument;

    expect(document.root).toBe(config.root);
    expect(document.totals).toEqual({
      repositories: SMALL.repos,
      files: SMALL.files,
      lines: SMALL.lines,
    });
    expect(document.repositories).toHaveLength(SMALL.repos);
    expect(document.session).toMatchObject({ name: SESSION, base: { mode: "head" } });
    expect(document.comments).toHaveLength(SMALL.comments);
    expect(document.counters.counters.total).toBe(SMALL.comments);
    expect(document.counters.repositories.length).toBeGreaterThan(0);
    expect(document.warnings).toEqual(expect.any(Array));
  });

  it("leaves the structured hunks out of the response and keeps them in diff.json", async () => {
    const document = (await (await app.request("/api/review")).json()) as ReviewDocument;
    const files = document.repositories.flatMap((repository) => repository.files);
    // The renderer reads `patch`; carrying the hunks as well costs more CPU per
    // scrolled frame than the budget of `docs/SPEC.md` section 6 has.
    expect(files.every((file) => file.hunks.length === 0)).toBe(true);
    expect(files.some((file) => file.patch.includes("@@"))).toBe(true);

    // The cache is the only place the hunks live: anchor capture reads them there.
    const cache = await readDiffCache(config.dataDir, SESSION);
    const cached = cache?.repositories.flatMap((repository) => repository.files) ?? [];
    expect(cached.some((file) => file.hunks.length > 0)).toBe(true);
    expect(cache?.totals).toEqual(document.totals);
  });

  it("serialises the document once and hands out the same bytes", async () => {
    const [first, second] = await Promise.all([
      (await app.request("/api/review")).text(),
      (await app.request("/api/review")).text(),
    ]);
    expect(first).toBe(second);
  });
});

describe("what a write costs the next reader", () => {
  it("does not lose a write that landed while it was reading", async () => {
    const service = createReviewService(config);
    await service.document();

    service.invalidateComments(SESSION);
    const reading = service.document();
    // While that read is in flight — the write itself is what follows it.
    service.invalidateComments(SESSION);
    await reading;

    const written = await addComment(config.dataDir, SESSION, {
      severity: "nit",
      body: "written while the comments were being read",
      author: "kim.p",
      role: "human",
    });
    // The second invalidation was not covered by the read that was running, so
    // it still stands and this read is a real one.
    const after = await service.document();
    expect(after.comments.map((one) => one.id)).toContain(written.id);
  });

  it("re-reads the comments alone, keeping the change set it already has", async () => {
    const service = createReviewService(config);
    const before = await service.document();
    await addComment(config.dataDir, SESSION, {
      severity: "nit",
      body: "written outside the server",
      author: "kim.p",
      role: "human",
    });

    service.invalidateComments(SESSION);
    const after = await service.document();
    expect(after.comments.length).toBe(before.comments.length + 1);
    expect(after.counters.counters.total).toBe(before.counters.counters.total + 1);
    // The same array, not a second read of `diff.json`: a comment write must
    // not charge the next reader of the review for the whole change set.
    expect(after.repositories).toBe(before.repositories);
    expect(after.totals).toBe(before.totals);
  });

  it("keeps a held document through a burst of the data directory that did not touch its task", async () => {
    const service = createReviewService(config);
    const before = await service.document(NAMED);
    service.dataChanged();
    // The same object, so the same serialised bytes: the burst cost two small reads.
    expect(await service.document(NAMED)).toBe(before);
  });

  it("answers a repository of the current task after a burst without reading its files again", async () => {
    let reads = 0;
    const counted = new Proxy(config, {
      get: (target, key, receiver) => {
        if (key === "dataDir") reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const service = createReviewService(counted);
    const held = await service.document();
    const first = held.repositories[0];
    if (first === undefined) throw new Error("the change set is empty");
    // Every rescan's lock is a burst too, and this is the fetch its frame makes.
    service.dataChanged();
    reads = 0;
    expect(await service.repository(first.path)).toBe(first);
    // The pointer and nothing else: `review.json` and the comments are not what it answers with.
    expect(reads).toBe(1);
  });
});

/** What the page sends with a write, so the CSRF guard reads it as one (07-server.md). */
const JSON_TYPE = { "content-type": "application/json" };

describe("a deleted task", () => {
  it("forgets what it held for it, so a task made again under the name is read afresh", async () => {
    const service = createReviewService(config);
    await createSession(config.dataDir, "again", { mode: "head" }, "first", { use: false });
    expect((await service.document("again")).session.title).toBe("first");

    // Deleted and made again by a CLI beside the server: nothing tells the service but `forget`.
    await deleteSession(config.dataDir, "again", { role: "human" });
    await createSession(config.dataDir, "again", { mode: "head" }, "second", { use: false });
    service.forget("again");
    expect((await service.document("again")).session.title).toBe("second");
    await deleteSession(config.dataDir, "again", { role: "human" });
  });

  it("is deleted by DELETE /api/sessions/:name, and the route refuses a task there is not", async () => {
    await createSession(config.dataDir, "doomed", { mode: "head" }, undefined, { use: false });
    expect((await app.request("/api/review?review=doomed")).status).toBe(200);

    const deleted = await app.request("/api/sessions/doomed", {
      method: "DELETE",
      headers: JSON_TYPE,
    });
    expect(deleted.status).toBe(200);
    // `synth` stays current: the task deleted was not.
    expect(await deleted.json()).toEqual({ name: "doomed", current: SESSION, moved: false });
    const after = await app.request("/api/review?review=doomed");
    expect(after.status).toBe(404);
    expect(await after.json()).toMatchObject({ error: "no-such-session" });

    const missing = await app.request("/api/sessions/doomed", {
      method: "DELETE",
      headers: JSON_TYPE,
    });
    expect(missing.status).toBe(404);
  });

  it("forgets a task a CLI deleted and made again beside a running server, with no call of its own", async () => {
    const server = await startReviewServer({ config: { ...config, port: 0 }, ui });
    const title = async () => {
      const response = await fetch(`${server.url}/api/review?review=made-again`);
      return ((await response.json()) as ReviewDocument).session.title;
    };
    try {
      await createSession(config.dataDir, "made-again", { mode: "head" }, "first", { use: false });
      expect(await title()).toBe("first");
      // What `review delete` and `review new` do from a terminal beside the server.
      await deleteSession(config.dataDir, "made-again", { role: "human" });
      await createSession(config.dataDir, "made-again", { mode: "head" }, "second", { use: false });
      // The watcher's burst is what tells the server: a frame's deadline, not a budget (11-perf.md).
      await expect.poll(title, { timeout: 20_000 }).toBe("second");
    } finally {
      await server.close();
      await deleteSession(config.dataDir, "made-again", { role: "human" });
    }
  });

  it("answers a session gone under a write with 404 no-such-session, not the 500 of storage", async () => {
    const probe = new Hono();
    probe.get("/", () => {
      throw new NoSuchSessionError("/data/reviews/gone");
    });
    probe.onError(errorResponse);
    const answer = await probe.request("/");
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ error: "no-such-session" });
  });
});

describe("the other routes", () => {
  it("lists the sessions with their counters", async () => {
    const list = (await (await app.request("/api/sessions")).json()) as {
      sessions: { name: string; current: boolean; open: number }[];
      warnings: string[];
    };
    // Three: the fixture's own, and the two tasks the change-set tests are about.
    expect(list.sessions.map((session) => session.name).sort()).toEqual(
      [SESSION, NAMED, SCOPED].sort(),
    );
    expect(list.sessions.find((session) => session.name === SESSION)).toMatchObject({
      current: true,
    });
    expect(list.warnings).toEqual([]);
  });

  it("gives the UI the user and the port", async () => {
    const settings = await (await app.request("/api/config")).json();
    expect(settings).toEqual({ user: config.user, port: config.port });
  });

  it("lists every repository under the root, with and without changes", async () => {
    const summary = (await (await app.request("/api/scan")).json()) as {
      root: string;
      repositories: { path: string; kind: string; hasChanges: boolean; branch: string }[];
    };
    expect(summary.root).toBe(config.root);
    // The scan finds one more than the review shows: the clean sibling worktree.
    expect(summary.repositories.length).toBe(SMALL.repos + 1);
    const worktree = summary.repositories.find((one) => one.path.endsWith("-worktree"));
    expect(worktree).toMatchObject({ kind: "worktree", hasChanges: false });
    expect(summary.repositories.filter((one) => one.hasChanges)).toHaveLength(SMALL.repos);
    expect(worktree?.branch).not.toBe("");
  });

  it("registers each method and path once", () => {
    // Hono answers with the first match, so an edit to a second copy does nothing. `use` and
    // `all` register as ALL and are chains by design: only a method's own handler is held.
    const handlers = app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`);
    expect(handlers).toContain("GET /api/repos/branches");
    expect(handlers.filter((pair, at) => handlers.indexOf(pair) !== at)).toEqual([]);
  });

  it("serves the page for anything that is not the API, and refuses an unknown API route", async () => {
    expect(await (await app.request("/")).text()).toBe(PAGE);
    // The UI routes in the browser, so a deep link is the page as well.
    expect(await (await app.request("/repo/file")).text()).toBe(PAGE);

    const missing = await app.request("/api/nope");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "no-such-route" });
  });

  it("says how to build the UI when there is none", async () => {
    const bare = createApp({
      activity: createActivityLog(),
      config,
      events: createEventStream(),
      review: createReviewService(config),
      ui: noUi,
    });
    const response = await bare.request("/");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("UI is not built");
  });
});

describe("a root with no current review session", () => {
  let empty: string;
  let bare: Hono;

  beforeAll(async () => {
    empty = mkdtempSync(join(tmpdir(), "diffalanche-empty-"));
    const emptyConfig = await loadConfig({ root: empty });
    bare = createApp({
      activity: createActivityLog(),
      config: emptyConfig,
      events: createEventStream(),
      review: createReviewService(emptyConfig),
      ui,
    });
  });

  afterAll(() => {
    rmSync(empty, { recursive: true, force: true });
  });

  it("refuses the review with the domain's own code and message", async () => {
    const response = await bare.request("/api/review");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "no-current-session",
      message: expect.stringContaining("no current review session"),
    });
  });

  it("starts, and answers the review with the domain's refusal", async () => {
    // Nothing to refresh before the first document: no session is current.
    const config = { ...(await loadConfig({ root: empty })), port: 0 };
    const server = await startReviewServer({ config, ui });
    try {
      const response = await fetch(`${server.url}/api/review`);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe("no-current-session");
    } finally {
      await server.close();
    }
  }, 120_000);

  it("still lists the sessions and the repositories, which is what the first run needs", async () => {
    expect(await (await bare.request("/api/sessions")).json()).toEqual({
      sessions: [],
      warnings: [],
    });
    const summary = (await (await bare.request("/api/scan")).json()) as { repositories: [] };
    expect(summary.repositories).toEqual([]);
  });
});

describe("a session that cannot be read", () => {
  let broken: string;
  let brokenConfig: Config;

  /** A session directory written by hand: a broken file cannot be written through storage. */
  function session(root: string, name: string, comments: string): void {
    const dir = join(root, ".diffalanche", "reviews", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "review.json"),
      JSON.stringify({
        version: 1,
        name,
        title: null,
        base: { mode: "head" },
        createdAt: "2026-09-01T09:00:00.000Z",
        updatedAt: "2026-09-01T09:00:00.000Z",
      }),
    );
    writeFileSync(join(dir, "comments.json"), comments);
  }

  beforeAll(async () => {
    broken = mkdtempSync(join(tmpdir(), "diffalanche-broken-"));
    session(broken, "half", "{ not json");
    writeFileSync(join(broken, ".diffalanche", "current"), "half\n");
    brokenConfig = await loadConfig({ root: broken });
  });

  afterAll(() => {
    rmSync(broken, { recursive: true, force: true });
  });

  it("starts the server anyway and answers with the file and the field", async () => {
    // Refusing to start would leave the person with no way to see why.
    const server = await startReviewServer({ config: { ...brokenConfig, port: 0 }, ui });
    try {
      const response = await fetch(`${server.url}/api/review`);
      expect(response.status).toBe(500);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("storage");
      expect(body.message).toContain("comments.json");
    } finally {
      await server.close();
    }
  }, 120_000);

  it("refuses a current pointer that is a path rather than a name", async () => {
    writeFileSync(join(broken, ".diffalanche", "current"), "../reviews/half\n");
    const app = createApp({
      activity: createActivityLog(),
      config: brokenConfig,
      events: createEventStream(),
      review: createReviewService(brokenConfig),
      ui,
    });
    const response = await app.request("/api/review");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "storage",
      message: expect.stringContaining("single path segment"),
    });
    writeFileSync(join(broken, ".diffalanche", "current"), "half\n");
  });
});

describe("which host the server answers for", () => {
  /** What a rebinding page sends: its own name in `Host`, and the same in `Origin`. */
  const REBOUND = "http://attacker.example:4880";

  async function write(url: string, headers: Record<string, string>): Promise<Response> {
    return app.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({}),
    });
  }

  it("refuses a read whose host is not one of its own, whatever the origin says", async () => {
    for (const headers of [{}, { origin: REBOUND }]) {
      const response = await app.request(`${REBOUND}/api/review`, { headers });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("forbidden");
      // The refusal names the host it turned down and every name it does take:
      // a sentence naming one of two would send the reader to the wrong fix.
      expect(body.message).toContain("attacker.example");
      expect(body.message).toContain("127.0.0.1");
      expect(body.message).toContain("localhost");
    }
  });

  it("refuses a host that merely carries a loopback name inside it", async () => {
    // A name is compared whole: matching a substring would let every one of
    // these through, and each is a name an attacker registers.
    for (const host of [
      "127.0.0.1.attacker.example",
      "localhost.attacker.example",
      "not-localhost",
      "127.0.0.1x",
    ]) {
      const response = await app.request(`http://${host}:4880/api/review`);
      expect(response.status, host).toBe(403);
      expect(await response.json()).toMatchObject({ error: "forbidden" });
    }
  });

  it("refuses a write from that host even though its origin matches it", async () => {
    const response = await write(`${REBOUND}/api/comments`, { origin: REBOUND });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "forbidden" });
  });

  it("takes the same two names however they are written", async () => {
    // The comparison is against what the URL parser made of the header, so the
    // short and the numeric spellings of 127.0.0.1 are that name, not another.
    for (const host of ["127.0.0.1", "localhost", "127.1", "0x7f000001"]) {
      const response = await app.request(`http://${host}:${config.port}/api/review`);
      expect(response.status, host).toBe(200);
    }
    // `[::1]` is what the parser gives for the IPv6 loopback, brackets and all,
    // and the socket is on 127.0.0.1, so nothing arrives under that name.
    expect((await app.request(`http://[::1]:${config.port}/api/review`)).status).toBe(403);
  });

  it("lets the real page and a request with no origin through to the handler", async () => {
    const own = `http://127.0.0.1:${config.port}`;
    expect((await app.request(`${own}/api/review`)).status).toBe(200);
    expect((await app.request(`http://localhost:${config.port}/api/review`)).status).toBe(200);

    // A body the handler refuses: it got there, which is what this asserts.
    for (const headers of [{}, { origin: own }]) {
      const response = await write(`${own}/api/comments`, headers);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid-request" });
    }
  });
});

describe("starting the server", () => {
  it("listens before it reports its port and picks one when asked for port 0", async () => {
    const server = await startReviewServer({ config: { ...config, port: 0 }, ui });
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
      const response = await fetch(`${server.url}/api/review`);
      expect(response.status).toBe(200);
      expect(((await response.json()) as ReviewDocument).totals.repositories).toBe(SMALL.repos);
    } finally {
      await server.close();
    }
  }, 120_000);

  it("cannot be reached from another address of this machine", async (context) => {
    const outside = Object.values(networkInterfaces())
      .flat()
      .find((address) => address && address.family === "IPv4" && !address.internal);
    // Reported, not passed over: what is left without one is that loopback
    // answers, which every other verdict in this file already establishes.
    if (!outside) {
      context.skip(
        "this machine has no non-internal IPv4 interface, so reaching the server off loopback " +
          "was not exercised; `startServer binds loopback without being told to` in " +
          "tests/runtime.test.ts is the check that holds here",
      );
      // `skip` throws; this is for the compiler, which cannot know that.
      return;
    }
    const server = await startReviewServer({ config: { ...config, port: 0 }, ui });
    try {
      expect(await (await fetch(`http://127.0.0.1:${server.port}/api/config`)).status).toBe(200);
      await expect(fetch(`http://${outside.address}:${server.port}/api/config`)).rejects.toThrow();
    } finally {
      await server.close();
    }
  }, 120_000);

  it("says in one sentence that the port is taken", async () => {
    const first = await startReviewServer({ config: { ...config, port: 0 }, ui });
    try {
      await expect(
        startReviewServer({ config: { ...config, port: first.port }, ui }),
      ).rejects.toThrow(/port \d+ is already in use/);
    } finally {
      await first.close();
    }
  }, 120_000);
});

/**
 * The change set behind the documents: which session's cache may be trusted,
 * what a switch back costs, and what a rescan announced before it was written
 * does to a document that is not there yet
 * ([07-server.md](../docs/reference/07-server.md)).
 */
describe("the change set a document is built from", () => {
  const MARK = "// the rescan that had not reached the file yet";

  /** The change set on disk with one file's patch marked: what a rescan hands
   * over before `diff.json` has it. */
  async function marked(session: string): Promise<DiffCache> {
    const cache = await readDiffCache(config.dataDir, session);
    if (cache === undefined || cache === null) throw new Error(`no cache for ${session}`);
    const repositories = cache.repositories.map((repository, at) =>
      at > 0
        ? repository
        : {
            ...repository,
            files: repository.files.map((file, index) =>
              index > 0 ? file : { ...file, patch: `${file.patch}\n${MARK}\n` },
            ),
          },
    );
    return { ...cache, repositories };
  }

  /** The first file of the first repository of a change set, as the cache orders them. */
  function firstFile(cache: { repositories: { path: string; files: { patch: string }[] }[] }): {
    repo: string;
    patch: string;
  } {
    const repository = cache.repositories[0];
    const file = repository?.files[0];
    if (repository === undefined || file === undefined) throw new Error("the change set is empty");
    return { repo: repository.path, patch: file.patch };
  }

  it("says whether a rescan reached a document that was held", async () => {
    const service = createReviewService(config);
    await service.document(SESSION);
    expect(service.adopt(SESSION, await marked(SESSION))).toBe(true);
    const document = await service.document(SESSION);
    expect(firstFile(document).patch).toContain(MARK);
  });

  it("keeps a rescan a cold document could not take, and builds from it", async () => {
    // `watched` is what makes a handed-over cache this session's: the watcher
    // rescans one session, and its cache is about that one.
    const service = createReviewService(config, { watched: () => SESSION });
    await service.document(SESSION);
    // What every write through the API leaves behind: ten routes call it.
    service.invalidate(SESSION);
    const rescan = await marked(SESSION);
    // Nothing is held to patch, and the answer says so rather than dropping it.
    expect(service.adopt(SESSION, rescan)).toBe(false);

    const change = await service.repository(firstFile(rescan).repo);
    expect(change?.files[0]?.patch).toContain(MARK);
  });

  it("takes a rescan that landed while the document was still being built", async () => {
    // Taken while the file is still there: the rescan this stands for is handed
    // over from memory, not read back.
    const rescan = await marked(SESSION);
    // Without a cache the build has to read every repository of the root, which
    // is what makes the window wide enough to land a rescan inside. `rebuild`
    // writes the file back, so the fixture repairs itself.
    rmSync(join(config.dataDir, "reviews", SESSION, "diff.json"));
    const scan = building(config);
    const service = createReviewService(scan.config, { watched: () => SESSION });
    let settled = false;
    const reading = service.document(SESSION).then((document) => {
      settled = true;
      return document;
    });
    // The build has begun its scan and not finished it: the rescan lands inside
    // it rather than before or after it, and a probe that wins by timing is not a probe.
    await scan.started();
    expect(settled).toBe(false);
    expect(service.adopt(SESSION, rescan)).toBe(false);
    expect(firstFile(await reading).patch).toContain(MARK);
  });

  it("holds one document per session, so a switch back builds nothing", async () => {
    const service = createReviewService(config);
    const first = await service.document(SESSION);
    await service.document(NAMED);
    const back = await service.document(SESSION);
    // The same object: a switch back is answered from memory, not from `diff.json`.
    expect(back).toBe(first);
  });

  it("trusts the cache of the session the watcher follows, and reads no repository for it", async () => {
    // The true side of the rule, which nothing covered: with `watched` wired the
    // document comes out of `diff.json`, so a mark that exists only in the file
    // reaches the screen. Without the wiring the working tree is read and the
    // mark is nowhere.
    const kept = (await readDiffCache(config.dataDir, SESSION)) as DiffCache;
    await writeDiffCache(config.dataDir, SESSION, await marked(SESSION));
    try {
      const followed = await createReviewService(config, {
        watched: () => SESSION,
      }).document(SESSION);
      expect(firstFile(followed).patch).toContain(MARK);

      const unwatched = await createReviewService(config).document(SESSION);
      expect(firstFile(unwatched).patch).not.toContain(MARK);
    } finally {
      await writeDiffCache(config.dataDir, SESSION, kept);
    }
  });

  it("does not start from the change set the previous run left", async () => {
    await createReviewService(config).document(SESSION);
    const kept = (await readDiffCache(config.dataDir, SESSION)) as DiffCache;
    // What a stopped server leaves: a cache whose base and scope still match a tree that moved on.
    await writeDiffCache(config.dataDir, SESSION, await marked(SESSION));
    const server = await startReviewServer({ config: { ...config, port: 0 }, ui });
    try {
      const document = (await (await fetch(`${server.url}/api/review`)).json()) as ReviewDocument;
      expect(document.session.name).toBe(SESSION);
      expect(firstFile(document).patch).not.toContain(MARK);
      expect(
        firstFile((await readDiffCache(config.dataDir, SESSION)) as DiffCache).patch,
      ).not.toContain(MARK);
    } finally {
      await server.close();
      await writeDiffCache(config.dataDir, SESSION, kept);
    }
  }, 120_000);

  it("reads a task that becomes current while it runs before it serves the task's cache", async () => {
    await createReviewService(config).document(NAMED);
    const kept = (await readDiffCache(config.dataDir, NAMED)) as DiffCache;
    // What a task that was not followed keeps: the cache of its last read, under a tree that moved on.
    await writeDiffCache(config.dataDir, NAMED, await marked(NAMED));
    const server = await startReviewServer({
      config: { ...config, port: 0 },
      ui,
      ...(NATIVE_WATCH ? {} : { recursive: false }),
    });
    const stream = await listen(`${server.url}/api/events`);
    try {
      // `review use` from a terminal, repeated: a write made while the recursive watch arms is lost
      // rather than late, and no longer wait brings it back (05-watcher.md).
      const deadline = performance.now() + 30_000;
      while (!stream.heard("current-changed")) {
        if (performance.now() > deadline) throw new Error("the watcher never followed the task");
        // biome-ignore lint/correctness/useHookAtTopLevel: the domain's `review use`, not a React hook
        await useSession(config.dataDir, NAMED);
        const until = performance.now() + 2_000;
        while (!stream.heard("current-changed") && performance.now() < until) {
          await new Promise((done) => setTimeout(done, 5));
        }
      }
      // What a window with no `?review=` does on that frame.
      const document = (await (await fetch(`${server.url}/api/review`)).json()) as ReviewDocument;
      expect(document.session.name).toBe(NAMED);
      expect(firstFile(document).patch).not.toContain(MARK);
      expect(
        firstFile((await readDiffCache(config.dataDir, NAMED)) as DiffCache).patch,
      ).not.toContain(MARK);
    } finally {
      await stream.close();
      await server.close();
      await useSession(config.dataDir, SESSION);
      await writeDiffCache(config.dataDir, NAMED, kept);
    }
  }, 120_000);

  it("drops a held document when a repository it could show has changed", async () => {
    const service = createReviewService(config, { watched: () => SESSION });
    const held = await service.document(NAMED);
    const { repo } = firstFile(held);
    // The session the watcher follows is patched by the rescan and is left alone.
    const current = await service.document(SESSION);
    service.repositoryChanged(repo);
    expect(await service.document(SESSION)).toBe(current);
    // The named task has no rescan behind it, so its document goes.
    expect(await service.document(NAMED)).not.toBe(held);
  });

  it("leaves a held document alone when the repository is outside its task", async () => {
    const service = createReviewService(config, { watched: () => SESSION });
    const held = await service.document(SCOPED);
    service.repositoryChanged(outOfScope);
    // The task is about one repository, and nothing changed in it: a signal
    // about another must not cost this window a rebuild.
    expect(await service.document(SCOPED)).toBe(held);
    service.repositoryChanged(inScope);
    expect(await service.document(SCOPED)).not.toBe(held);
  });

  it("keeps a build whose signal was about a repository the task is not on", async () => {
    const scan = building(config);
    const service = createReviewService(scan.config, { watched: () => SESSION });
    let settled = false;
    const reading = service.document(SCOPED).then((document) => {
      settled = true;
      return document;
    });
    // A signal that lands before the build starts needs no answer: the build
    // then reads the working tree after the change and is already right. Only a
    // signal inside the build is the case this is about, and the assertion is
    // what says it landed there.
    await scan.started();
    expect(settled).toBe(false);
    service.repositoryChanged(outOfScope);
    const built = await reading;
    // The signal was about another repository, so the document stays: the cost
    // of a build is paid once per session, not once per unrelated write.
    expect(await service.document(SCOPED)).toBe(built);
  });

  it("drops a build whose signal was about a repository the task is on", async () => {
    const scan = building(config);
    const service = createReviewService(scan.config, { watched: () => SESSION });
    let settled = false;
    // The whole root, so the build is long enough to land a signal inside it.
    const reading = service.document(NAMED).then((document) => {
      settled = true;
      return document;
    });
    await scan.started();
    expect(settled).toBe(false);
    service.repositoryChanged(inScope);
    const built = await reading;
    // Answered, and not kept: this build may have read the repository before
    // the change, so the next request builds again.
    expect(await service.document(NAMED)).not.toBe(built);
  });

  it("keeps a rescan that landed while a held document's files were read again", async () => {
    const rescan = await marked(SESSION);
    let armed: (() => void) | null = null;
    // Sprung at the next read of the data directory: the re-read, once it has taken the document.
    const reading = new Proxy(config, {
      get: (target, key, receiver) => {
        if (key === "dataDir" && armed !== null) {
          const run = armed;
          armed = null;
          run();
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const service = createReviewService(reading, { watched: () => SESSION });
    await service.document(SESSION);
    await addComment(config.dataDir, SESSION, {
      severity: "nit",
      body: "written while the change set moved",
      author: "kim.p",
      role: "human",
    });
    service.dataChanged();
    const asked = service.document(SESSION);
    let patched = false;
    armed = () => {
      patched = service.adopt(SESSION, rescan);
    };
    await asked;
    expect(patched).toBe(true);
    expect(firstFile(await service.document(SESSION)).patch).toContain(MARK);
  });

  it("takes the rescan of a task that became the followed one while its build ran", async () => {
    // A cache on disk for the mark to be made from.
    await createReviewService(config).document(NAMED);
    const rescan = await marked(NAMED);
    const scan = building(config);
    let watching: string | null = SESSION;
    const service = createReviewService(scan.config, { watched: () => watching });
    let settled = false;
    const reading = service.document(NAMED).then((document) => {
      settled = true;
      return document;
    });
    await scan.started();
    expect(settled).toBe(false);
    // `current` lands on the task while its build runs, which is what a request made during the
    // move's read meets: from here the watcher's rescans are about this task.
    watching = NAMED;
    expect(service.adopt(NAMED, rescan)).toBe(false);
    service.repositoryChanged(firstFile(rescan).repo);
    await reading;
    expect(firstFile(await service.document(NAMED)).patch).toContain(MARK);
  });

  it("charges a comment write the comments and not the change set", async () => {
    const service = createReviewService(config);
    const before = await service.document(NAMED);
    await addComment(config.dataDir, NAMED, {
      severity: "nit",
      body: "written on a task the watcher does not follow",
      author: "kim.p",
      role: "human",
    });
    service.invalidateComments(NAMED);
    const after = await service.document(NAMED);
    expect(after.comments.length).toBe(before.comments.length + 1);
    // The same array: a comment must not charge the next reader for a read of
    // every repository of the scope.
    expect(after.repositories).toBe(before.repositories);
  });

  it("reads a named task from the working tree, not from a cache nothing refreshed", async () => {
    const service = createReviewService(config);
    const before = await service.document(NAMED);
    const { repo, patch } = firstFile(before);
    expect(patch).not.toContain(MARK);
    const file = before.repositories[0]?.files[0]?.path;
    if (file === undefined) throw new Error("the change set is empty");

    const onDisk = join(root, repo, file);
    const kept = readFileSync(onDisk, "utf8");
    writeFileSync(onDisk, `${kept}${MARK}\n`);
    try {
      // The cache of that task still says what it said: nothing rewrote it.
      const cache = await readDiffCache(config.dataDir, NAMED);
      expect(firstFile(cache as DiffCache).patch).not.toContain(MARK);

      const after = await createReviewService(config).document(NAMED);
      expect(firstFile(after).patch).toContain(MARK);
    } finally {
      writeFileSync(onDisk, kept);
    }
  });
});

describe("a held document of a task nobody follows", () => {
  type Listener = Awaited<ReturnType<typeof listen>>;

  /** `SESSION` current and `NAMED` beside it, in a data directory of its own: the tasks that
   * prove a burst was read are created here and must not reach the shared fixture. */
  async function ownDataDir(): Promise<string> {
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-unfollowed-"));
    await createSession(dataDir, SESSION, { mode: "head" });
    await createSession(dataDir, NAMED, { mode: "head" }, undefined, { use: false });
    return dataDir;
  }

  /** Creates a task and waits for its frame, which ends every burst before it. Repeated while
   * the watch arms: a write made then is lost rather than late (05-watcher.md). */
  async function barrier(dataDir: string, stream: Listener, name: string): Promise<void> {
    const deadline = performance.now() + 30_000;
    for (let attempt = 0; ; attempt += 1) {
      const task = `${name}-${attempt}`;
      await createSession(dataDir, task, { mode: "head" }, undefined, { use: false });
      const patience = performance.now() + 2_000;
      while (performance.now() < patience) {
        if (stream.said(`"name":"${task}"`)) return;
        await new Promise((done) => setTimeout(done, 5));
      }
      if (performance.now() > deadline) throw new Error("the data directory's watch never spoke");
    }
  }

  async function reviewOf(url: string, name: string): Promise<ReviewDocument> {
    return (await (await fetch(`${url}/api/review?review=${name}`)).json()) as ReviewDocument;
  }

  /** A server on its own data directory, a window on `current` that hears every frame, and a
   * document of `NAMED` held by a window that opened it by name and went away. */
  async function held(): Promise<{
    dataDir: string;
    server: Awaited<ReturnType<typeof startReviewServer>>;
    current: Listener;
    document: ReviewDocument;
    close: () => Promise<void>;
  }> {
    const dataDir = await ownDataDir();
    const server = await startReviewServer({
      config: { ...config, dataDir, port: 0 },
      ui,
      ...(NATIVE_WATCH ? {} : { recursive: false }),
    });
    const current = await listen(`${server.url}/api/events`);
    await barrier(dataDir, current, "armed");
    const document = await reviewOf(server.url, NAMED);
    const window = await listen(`${server.url}/api/events?review=${NAMED}`);
    await window.close();
    // The client's end reaches the server later, and until then the watcher still follows the
    // task: the write below would be a followed task's, which is not the case under test.
    const deadline = performance.now() + 20_000;
    while (server.windows().includes(NAMED)) {
      if (performance.now() > deadline) throw new Error("the server never saw the window close");
      await new Promise((done) => setTimeout(done, 5));
    }
    return {
      dataDir,
      server,
      current,
      document,
      close: async () => {
        await current.close();
        await server.close();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  }

  it("carries a comment the CLI wrote while no window was on the task", async () => {
    const run = await held();
    try {
      expect(run.document.comments).toEqual([]);
      const written = await addComment(run.dataDir, NAMED, {
        severity: "nit",
        body: "written from a terminal while no window was on the task",
        author: "kim.p",
        role: "human",
      });
      await barrier(run.dataDir, run.current, "read");
      // The window's end reached the server before the write, so no frame named the comment and
      // only the burst's mark can bring it into the document.
      expect(run.current.said(written.id)).toBe(false);
      const again = await reviewOf(run.server.url, NAMED);
      expect(again.comments.map((one) => one.id)).toContain(written.id);
    } finally {
      await run.close();
    }
  }, 120_000);

  /** One call made, once armed, where a walk of the root asks for `exclude`: the start of a move's
   * read, before any repository. A rescan and the symbol index read `root` alone. */
  function absorbing(of: Config): { config: Config; arm: (run: () => void) => void } {
    let armed: (() => void) | null = null;
    const config = new Proxy(of, {
      get: (target, key, receiver) => {
        if (key === "exclude" && armed !== null) {
          const run = armed;
          armed = null;
          run();
        }
        return Reflect.get(target, key, receiver);
      },
    });
    return {
      config,
      arm: (run) => {
        armed = run;
      },
    };
  }

  it("drops another task's document when a move's read absorbed an edit back to the old cache", async () => {
    const EDIT = "// an edit made while nothing followed the task";
    const dataDir = await ownDataDir();
    const own = { ...config, dataDir, port: 0 };
    // The cache `NAMED` keeps from its last read, and an edit made since, while nothing followed it.
    const { repositories } = await createReviewService(own).document(NAMED);
    const repo = repositories[0]?.path;
    const file = repositories[0]?.files[0]?.path;
    if (repo === undefined || file === undefined) throw new Error("the change set is empty");
    const onDisk = join(root, repo, file);
    const kept = readFileSync(onDisk, "utf8");
    writeFileSync(onDisk, `${kept}${EDIT}\n`);
    const shown = (document: ReviewDocument): string =>
      document.repositories.find((one) => one.path === repo)?.files.find((one) => one.path === file)
        ?.patch ?? "";
    const move = absorbing(own);
    const server = await startReviewServer({
      config: move.config,
      ui,
      ...(NATIVE_WATCH ? {} : { recursive: false }),
    });
    const current = await listen(`${server.url}/api/events`);
    try {
      await barrier(dataDir, current, "armed");
      expect(shown(await reviewOf(server.url, SESSION))).toContain(EDIT);
      // The revert lands inside the read `review use` starts: the read finds what the old cache
      // said, and the revert's own rescan finds nothing the new one does not.
      let reverted = false;
      move.arm(() => {
        writeFileSync(onDisk, kept);
        reverted = true;
      });
      const deadline = performance.now() + 30_000;
      while (!current.heard("current-changed")) {
        if (performance.now() > deadline) throw new Error("the watcher never followed the task");
        // biome-ignore lint/correctness/useHookAtTopLevel: the domain's `review use`, not a React hook
        await useSession(dataDir, NAMED);
        const until = performance.now() + 2_000;
        while (!current.heard("current-changed") && performance.now() < until) {
          await new Promise((done) => setTimeout(done, 5));
        }
      }
      expect(reverted).toBe(true);
      // The task `current` left holds a document of the edit: it has to go once the tree is back.
      const patience = performance.now() + 20_000;
      let after = shown(await reviewOf(server.url, SESSION));
      while (after.includes(EDIT) && performance.now() < patience) {
        await new Promise((done) => setTimeout(done, 20));
        after = shown(await reviewOf(server.url, SESSION));
      }
      expect(after).not.toContain(EDIT);
    } finally {
      writeFileSync(onDisk, kept);
      await current.close();
      await server.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("carries a scope the CLI set while no window was on the task", async () => {
    const run = await held();
    try {
      expect(run.document.repositories.some((one) => one.path !== inScope)).toBe(true);
      const scope = [{ repo: inScope, paths: null }];
      await setScope(run.dataDir, NAMED, scope, await findRepositories(config));
      await barrier(run.dataDir, run.current, "read");
      const again = await reviewOf(run.server.url, NAMED);
      expect(again.session.scope).toEqual(scope);
      expect(again.repositories.filter((one) => one.path !== inScope)).toEqual([]);
    } finally {
      await run.close();
    }
  }, 120_000);

  describe("a window that has just opened on it", () => {
    type Server = Awaited<ReturnType<typeof startReviewServer>>;

    /** A server on its own data directory and a window on `current` that hears every frame. */
    async function started(prepare?: (dataDir: string) => Promise<void>): Promise<{
      dataDir: string;
      server: Server;
      current: Listener;
      close: () => Promise<void>;
    }> {
      const dataDir = await ownDataDir();
      await prepare?.(dataDir);
      const server = await startReviewServer({
        config: { ...config, dataDir, port: 0 },
        ui,
        ...(NATIVE_WATCH ? {} : { recursive: false }),
      });
      const current = await listen(`${server.url}/api/events`);
      await barrier(dataDir, current, "armed");
      return {
        dataDir,
        server,
        current,
        close: async () => {
          await current.close();
          await server.close();
          rmSync(dataDir, { recursive: true, force: true });
        },
      };
    }

    /** Until the server counts a window on `NAMED`, or no longer does. */
    async function counted(server: Server, open: boolean): Promise<void> {
      const deadline = performance.now() + 20_000;
      while (server.windows().includes(NAMED) !== open) {
        if (performance.now() > deadline)
          throw new Error(`the window never ${open ? "opened" : "closed"}`);
        await new Promise((done) => setTimeout(done, 5));
      }
    }

    /** `started`, and a window served `NAMED` whose stream is open: nothing written into the task
     * since `prepare`. */
    async function opened(prepare?: (dataDir: string) => Promise<void>): Promise<{
      dataDir: string;
      current: Listener;
      window: Listener;
      close: () => Promise<void>;
    }> {
      const run = await started(prepare);
      // The order a page keeps, the document before the stream, with a burst between the two: the
      // document's own lock is one, and it must not stand in for the write under test.
      await reviewOf(run.server.url, NAMED);
      await barrier(run.dataDir, run.current, "served");
      const window = await listen(`${run.server.url}/api/events?review=${NAMED}`);
      await counted(run.server, true);
      return {
        dataDir: run.dataDir,
        current: run.current,
        window,
        close: async () => {
          await window.close();
          await run.close();
        },
      };
    }

    it("hears a comment written before any other burst of the data directory", async () => {
      const run = await opened();
      try {
        const written = await addComment(run.dataDir, NAMED, {
          severity: "nit",
          body: "written by an agent into the task it just printed a link to",
          author: "kim.p",
          role: "human",
        });
        await barrier(run.dataDir, run.current, "read");
        expect(run.window.said(written.id)).toBe(true);
      } finally {
        await run.close();
      }
    }, 120_000);

    it("hears a scope set from a terminal before any other burst of the data directory", async () => {
      const run = await opened();
      try {
        const found = await findRepositories(config);
        await setScope(run.dataDir, NAMED, [{ repo: inScope, paths: null }], found);
        await barrier(run.dataDir, run.current, "read");
        expect(run.window.said(`{"type":"session-changed","name":"${NAMED}"}`)).toBe(true);
      } finally {
        await run.close();
      }
    }, 120_000);

    const note = { severity: "nit", author: "kim.p", role: "human" } as const;

    it("is not told the comments its document already had", async () => {
      let history = "";
      const run = await opened(async (dataDir) => {
        history = (await addComment(dataDir, NAMED, { ...note, body: "there before" })).id;
      });
      try {
        const written = await addComment(run.dataDir, NAMED, { ...note, body: "written since" });
        await barrier(run.dataDir, run.current, "read");
        expect(run.window.said(written.id)).toBe(true);
        expect(run.window.said(history)).toBe(false);
        // A comment write rewrites `review.json` too, and what the review is did not change.
        expect(run.window.heard("session-changed")).toBe(false);
      } finally {
        await run.close();
      }
    }, 120_000);

    it("is not told a comment outside its scope, which its document could not show", async () => {
      let outside = "";
      const run = await opened(async (dataDir) => {
        await setScope(dataDir, NAMED, [{ repo: inScope, paths: null }], [inScope, outOfScope]);
        outside = (await addComment(dataDir, NAMED, { ...note, body: "moved out by hand" })).id;
        // Nothing writes such a comment: a `comments.json` edited by hand is where it comes from.
        const moved = (await readComments(dataDir, NAMED)).map((one) =>
          one.id === outside ? { ...one, repo: outOfScope } : one,
        );
        await writeComments(dataDir, NAMED, moved);
      });
      try {
        const written = await addComment(run.dataDir, NAMED, { ...note, body: "written since" });
        await barrier(run.dataDir, run.current, "read");
        expect(run.window.said(written.id)).toBe(true);
        expect(run.window.said(outside)).toBe(false);
        expect(run.window.heard("session-changed")).toBe(false);
      } finally {
        await run.close();
      }
    }, 120_000);

    it("hears what landed between two windows' documents, compared with the earlier one", async () => {
      const run = await started();
      let window: Listener | null = null;
      try {
        await reviewOf(run.server.url, NAMED);
        await barrier(run.dataDir, run.current, "served");
        const between = await addComment(run.dataDir, NAMED, { ...note, body: "between the two" });
        await barrier(run.dataDir, run.current, "written");
        // The second window's document has the comment; the first one's does not.
        const later = await reviewOf(run.server.url, NAMED);
        expect(later.comments.map((one) => one.id)).toContain(between.id);
        window = await listen(`${run.server.url}/api/events?review=${NAMED}`);
        await counted(run.server, true);
        await barrier(run.dataDir, run.current, "read");
        expect(window.said(between.id)).toBe(true);
      } finally {
        await window?.close();
        await run.close();
      }
    }, 120_000);

    it("is not told what was written while no window was on it, after it left the followed set", async () => {
      const run = await started();
      let window: Listener | null = null;
      try {
        // A window on the task, followed, and served its document again after its own lock's
        // burst: a reload, or the re-read `session-changed` asks for.
        const first = await listen(`${run.server.url}/api/events?review=${NAMED}`);
        await counted(run.server, true);
        await reviewOf(run.server.url, NAMED);
        await barrier(run.dataDir, run.current, "followed");
        await reviewOf(run.server.url, NAMED);
        await first.close();
        await counted(run.server, false);
        await barrier(run.dataDir, run.current, "left");
        const written = await addComment(run.dataDir, NAMED, { ...note, body: "while nobody" });
        await barrier(run.dataDir, run.current, "written");
        // A window whose stream opens before its document, as a switch of task does.
        window = await listen(`${run.server.url}/api/events?review=${NAMED}`);
        await counted(run.server, true);
        await barrier(run.dataDir, run.current, "read");
        expect(window.said(written.id)).toBe(false);
      } finally {
        await window?.close();
        await run.close();
      }
    }, 120_000);

    it("is not told what was written after its window closed with no burst while it was open", async () => {
      const run = await started();
      let window: Listener | null = null;
      try {
        await reviewOf(run.server.url, NAMED);
        await barrier(run.dataDir, run.current, "served");
        // A window served the task, its stream opened and closed in a quiet moment: no burst ever
        // followed the task, so only the stream's end can say the window is gone.
        const first = await listen(`${run.server.url}/api/events?review=${NAMED}`);
        await counted(run.server, true);
        await first.close();
        await counted(run.server, false);
        const written = await addComment(run.dataDir, NAMED, { ...note, body: "while nobody" });
        await barrier(run.dataDir, run.current, "written");
        // A window whose stream opens before its document, as a switch of task does.
        window = await listen(`${run.server.url}/api/events?review=${NAMED}`);
        await counted(run.server, true);
        await barrier(run.dataDir, run.current, "read");
        expect(window.said(written.id)).toBe(false);
      } finally {
        await window?.close();
        await run.close();
      }
    }, 120_000);

    it("is not told the history of a task deleted and made again since its document", async () => {
      const run = await started();
      let window: Listener | null = null;
      try {
        await reviewOf(run.server.url, NAMED);
        await barrier(run.dataDir, run.current, "served");
        await deleteSession(run.dataDir, NAMED, { role: "human" });
        await barrier(run.dataDir, run.current, "deleted");
        await createSession(run.dataDir, NAMED, { mode: "head" }, undefined, { use: false });
        const own = await addComment(run.dataDir, NAMED, { ...note, body: "the new task's own" });
        await barrier(run.dataDir, run.current, "made-again");
        window = await listen(`${run.server.url}/api/events?review=${NAMED}`);
        await counted(run.server, true);
        await barrier(run.dataDir, run.current, "read");
        expect(window.said(own.id)).toBe(false);
      } finally {
        await window?.close();
        await run.close();
      }
    }, 120_000);
  });
});
