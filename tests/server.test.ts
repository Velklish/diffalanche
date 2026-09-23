/**
 * The server of DA-16: the review in one document, the sessions, the settings,
 * the scan, and the built UI, on `127.0.0.1` and nowhere else.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { findRepositories } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, createSession, useSession } from "../src/core/domain/index.ts";
import type { DiffCache } from "../src/core/storage/index.ts";
import { readDiffCache, writeDiffCache } from "../src/core/storage/index.ts";
import type { ReviewDocument } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
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

/** An SSE response read as text as it arrives: enough to ask whether a frame has come. */
function listen(response: Response): {
  heard: (event: string) => boolean;
  close: () => Promise<void>;
} {
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
    close: async () => {
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
    const stream = listen(await fetch(`${server.url}/api/events`));
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
