import type { Context } from "hono";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { findRepositories } from "../core/change-set.ts";
import type { Config } from "../core/config/index.ts";
import {
  addComment,
  assertScope,
  closeSession,
  createSession,
  exportMarkdown,
  get as getComment,
  list,
  listSessions,
  parseBaseArgument,
  readSession,
  reopen,
  reopenSession,
  reply,
  resolve,
  resolveSessionName,
  setBase,
  setScope,
  useSession,
} from "../core/domain/index.ts";
import type { Comment, Role } from "../core/storage/index.ts";
import type { ActivityLog } from "../core/watcher/index.ts";
import type { UiAssets } from "./assets.ts";
import type { ErrorBody } from "./errors.ts";
import { errorResponse, ForbiddenError, RequestError } from "./errors.ts";
import type { EventStream } from "./events.ts";
import { streamEvents } from "./events.ts";
import {
  choice,
  consent,
  nullableLine,
  nullableText,
  optionalText,
  readBody,
  scope,
  severity,
  side,
  text,
} from "./request.ts";
import type { ReviewService } from "./review.ts";
import { listBranches } from "./routes/branches.ts";
import { fileRoute, fileSource, treeRoute } from "./routes/browse.ts";
import { symbolIndexOf, symbolRoute, textRoute } from "./routes/search.ts";

export type AppOptions = {
  config: Config;
  review: ReviewService;
  ui: UiAssets;
  /** The live stream; without one the server serves no `/api/events`. */
  events: EventStream;
  /** The feed the stream's `activity` frames are recorded in. */
  activity: ActivityLog;
  /** Request logging to stderr. Off unless `serve` was given `--verbose`. */
  verbose?: boolean | undefined;
};

/** The methods that change nothing, and so need no guard on where they came from. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The names the IPv4 loopback socket answers for, as the URL parser normalises
 * them; it binds `127.0.0.1`, so `[::1]` reaches no one and is not here. */
const OWN_HOSTS: readonly string[] = ["127.0.0.1", "localhost"];

/** The host the request arrived on, as the runtime built it from `Host`;
 * `null` when the header is not a host at all. */
function requestHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The review task a request is about: `?review=<name>`, and the current session
 * without it. **Every route a window uses reads it, reading and writing alike.**
 * A window opened on a task shows that task, so a comment written in it belongs
 * to that task; without this a window on one task would write into another, and
 * a finding stored where nothing reads it back is the loss product principle 5
 * forbids. `current` stays what a human typing a command by hand gets, and only
 * `review use` moves it ([ADR-010](../../docs/adr/adr-010-review-task-scope.md),
 * decision 7).
 */
function named(c: Context): string | undefined {
  const name = c.req.query("review");
  return name === undefined || name === "" ? undefined : name;
}

/** What `GET /api/config` gives the UI: the two settings it has to know. */
export type ClientConfig = { user: string; port: number };

/**
 * The server of `docs/reference/07-server.md`: the review in one response, the
 * sessions, the settings, and the built UI. Every refusal comes from the domain
 * and keeps its message ([errors.ts](errors.ts)).
 */
export function createApp({ activity, config, events, review, ui, verbose }: AppOptions): Hono {
  const app = new Hono();
  /** What the UI signs with: the configured name, and never an agent's role. */
  const author = { author: config.user, role: "human" as Role };

  // Reads included: a rebinding page must name itself in `Host`, so this is
  // what stops it reading the review ("Which host it answers for" in 07-server.md).
  app.use("/api/*", async (c, next) => {
    const host = requestHost(c.req.url);
    if (host === null || !OWN_HOSTS.includes(host)) {
      throw new ForbiddenError(
        `this server answers for ${OWN_HOSTS.join(" and ")} only, not ${host ?? "a host header that is not a host"}`,
      );
    }
    await next();
  });

  // Three guards on who is writing, because the server has no authentication
  // ("Who may write" in 07-server.md); a request with no `Origin` is not a page.
  app.use("/api/*", csrf());
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (!SAFE_METHODS.has(c.req.method) && origin !== undefined) {
      if (origin !== new URL(c.req.url).origin) {
        throw new ForbiddenError(`a write from ${origin} is not this review's own page`);
      }
    }
    await next();
  });

  if (verbose === true) {
    app.use("*", async (c, next) => {
      const started = Date.now();
      await next();
      const path = new URL(c.req.url).pathname;
      process.stderr.write(`${c.req.method} ${path} ${c.res.status} ${Date.now() - started} ms\n`);
    });
  }

  // One symbol index a server, made when a review is first read (ADR-015).
  const symbols = symbolIndexOf(config, events);

  // Serialised once per change, not once per request: the review is megabytes.
  // `?review=<name>` is the task an agent printed a link to; without it the
  // current session, as before ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
  app.get("/api/review", async (c) => {
    const payload = await review.payload(named(c));
    // The symbol index is read in the background once a review is open, not on the first question
    // (ADR-015); the document is the one just served, held.
    void review.document(named(c)).then(
      (document) => symbols().warm(document.repositories),
      () => {},
    );
    return c.body(payload, 200, { "content-type": "application/json" });
  });

  app.get("/api/sessions", async (c) => c.json(await listSessions(config.dataDir)));

  // The change set of the whole root, whatever the session is about: what the
  // scope editor offers to pick from. It is the one answer a scoped session
  // gives about anything outside its scope, and it is a picker's list rather
  // than a review — no patch, no hunks.
  app.get("/api/sessions/candidates", async (c) => c.json(await review.candidates(named(c))));

  app.get("/api/config", (c) => c.json<ClientConfig>({ user: config.user, port: config.port }));

  // Every branch the base picker may choose from, over the whole root. Like
  // the scan, it reads git per request: there is no cache of refs, and the
  // picker is opened by hand rather than on every reload.
  app.get("/api/repos/branches", async (c) => c.json(await listBranches(config)));

  // What the UI fetches after an event names it, and the stream that names it.
  app.get("/api/events", streamEvents(events));

  // A repository of the review outside its diff: every file, and one file whole (DA-37).
  app.get("/api/repos/:repo{.+}/tree", (c) => treeRoute(c, config, review, named(c)));
  app.get("/api/repos/:repo{.+}/file", (c) => fileRoute(c, config, review, named(c)));

  app.get("/api/repos/:repo{.+}/diff", async (c) => {
    const repo = c.req.param("repo");
    const change = await review.repository(repo, named(c));
    if (change === null) {
      return c.json<ErrorBody>(
        { error: "no-such-repository", message: `no repository ${repo} in this change set` },
        404,
      );
    }
    return c.json(change);
  });

  // Text in the working tree of every repository of the review, a page at a time (DA-38).
  app.get("/api/search/text", (c) => textRoute(c, config, review, named(c)));
  // Definitions by name, from the index a review read starts building (DA-39).
  app.get("/api/search/symbols", (c) => symbolRoute(c, config, review, named(c), symbols()));

  app.get("/api/comments/:id", async (c) =>
    c.json(
      await getComment(
        config.dataDir,
        await resolveSessionName(config.dataDir, named(c)),
        c.req.param("id"),
      ),
    ),
  );

  app.get("/api/warnings", async (c) => c.json((await review.document(named(c))).warnings));

  // What the feed shows before anything happens: the lines the server noticed
  // while it has been running, oldest first, the same shape the `activity`
  // frames of the stream carry. They live in memory and are gone with the
  // server ([ADR-005](../../docs/adr/adr-005-live-update.md)).
  app.get("/api/activity", (c) => c.json(activity.recent()));

  // Every branch the base picker may choose from, over the whole root. Like
  // the scan, it reads git per request: there is no cache of refs, and the
  // picker is opened by hand rather than on every reload.
  app.get("/api/repos/branches", async (c) => c.json(await listBranches(config)));

  // Every repository under the root, with whether it has anything to review.
  // This is the one route that reads git per request: it exists for the screen
  // shown before there is a session, and there is no cache to answer it from.
  app.get("/api/scan", async (c) => c.json(await review.summary()));

  // ---------------------------------------------------------------------
  // writing
  // ---------------------------------------------------------------------
  // Every write goes through the domain with the name from the configuration
  // and `role: human`: the UI is the human, and the CLI is where an agent
  // writes ([ADR-004](../../docs/adr/adr-004-agent-contract.md)). The watcher
  // turns the file that changed into the events the UI listens for. A write to
  // the comments re-reads the comments alone; a write to the review itself
  // drops that session's document ([07-server.md](../../docs/reference/07-server.md)).

  app.post("/api/comments", async (c) => {
    const body = await readBody(c);
    const session = await resolveSessionName(config.dataDir, named(c));
    const repo = nullableText(body, "repo");
    const path = nullableText(body, "path");
    // A comment names a repository the root has; the anchor is taken from the
    // change set as it was shown, and the repository is not read again for it.
    // That the task's scope covers it is the domain's check, one level down
    // ([04-domain.md](../../docs/reference/04-domain.md)).
    if (repo !== null && !(await findRepositories(config)).includes(repo)) {
      throw new RequestError(`repo ${repo} is not a repository under the root`);
    }
    const comment = await addComment(
      config.dataDir,
      session,
      {
        repo,
        path,
        line: nullableLine(body, "line"),
        endLine: nullableLine(body, "endLine"),
        side: side(body),
        severity: severity(body),
        body: text(body, "body"),
        ...author,
      },
      { source: fileSource(config) },
    );
    review.invalidateComments(session);
    return c.json(comment, 201);
  });

  app.post("/api/comments/:id/replies", async (c) => {
    const body = await readBody(c);
    const session = await resolveSessionName(config.dataDir, named(c));
    const comment = await reply(config.dataDir, session, c.req.param("id"), {
      body: text(body, "body"),
      ...author,
    });
    review.invalidateComments(session);
    return c.json(comment, 201);
  });

  app.post("/api/comments/:id/resolve", async (c) =>
    c.json(await verdict(c, c.req.param("id"), resolve)),
  );

  app.post("/api/comments/:id/reopen", async (c) =>
    c.json(await verdict(c, c.req.param("id"), reopen)),
  );

  /** `resolve` and `reopen` differ only in which of them is called. */
  async function verdict(
    c: Context,
    id: string,
    close: (
      dataDir: string,
      session: string,
      id: string,
      given: { author: string; role: Role; note?: string },
    ) => Promise<Comment>,
  ): Promise<Comment> {
    const body = await readBody(c);
    const note = optionalText(body, "note");
    const session = await resolveSessionName(config.dataDir, named(c));
    const comment = await close(config.dataDir, session, id, {
      ...author,
      ...(note === undefined ? {} : { note }),
    });
    review.invalidateComments(session);
    return comment;
  }

  // A session, and a review task is one with a scope: `scope` builds it in the
  // same write rather than leaving a moment where the task is about the whole
  // root. `use: false` is `review new --no-use` — the task is written and
  // `current` is left where the human's own commands put it, which is what the
  // UI always asks for ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
  app.post("/api/sessions", async (c) => {
    const body = await readBody(c);
    const base = parseBaseArgument(optionalText(body, "base") ?? "head");
    const title = optionalText(body, "title");
    const wanted = scope(body);
    if (wanted !== null) assertScope(wanted, await findRepositories(config));
    const created = await createSession(config.dataDir, text(body, "name"), base, title, {
      ...(wanted === null ? {} : { scope: wanted }),
      ...(body.use === undefined ? {} : { use: consent(body, "use") }),
    });
    review.invalidate(created.name);
    return c.json(created, 201);
  });

  // The route invalidates nothing: the documents are held per session, so
  // moving `current` only changes which one a bare request resolves to.
  app.post("/api/sessions/:name/use", async (c) =>
    c.json(await useSession(config.dataDir, c.req.param("name"))),
  );

  // The scope is replaced whole rather than edited entry by entry: the editor
  // of DA-55 holds the list the person sees, and one write is one state. What
  // it removes takes its comments with it, and the consent for that is in the
  // body: without it the answer is a 409 that names how many there are and
  // writes nothing ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
  app.put("/api/sessions/:name/scope", async (c) => {
    const body = await readBody(c);
    const name = c.req.param("name");
    const updated = await setScope(
      config.dataDir,
      name,
      scope(body),
      await findRepositories(config),
      { dropComments: consent(body, "dropComments") },
    );
    review.invalidate(name);
    return c.json(updated.review);
  });

  app.post("/api/sessions/:name/close", async (c) => {
    // Signed with the configured user and `role: human`, like every write here:
    // the UI is the human, and only a human closes a task
    // ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)). Nothing in the
    // request can say otherwise.
    const session = await closeSession(config.dataDir, c.req.param("name"), author);
    review.invalidate(session.name);
    return c.json(session);
  });

  app.post("/api/sessions/:name/reopen", async (c) => {
    const session = await reopenSession(config.dataDir, c.req.param("name"), author);
    review.invalidate(session.name);
    return c.json(session);
  });

  app.put("/api/sessions/:name/base", async (c) => {
    const body = await readBody(c);
    const name = c.req.param("name");
    const session = await setBase(config.dataDir, name, parseBaseArgument(text(body, "base")));
    // `diff.json` records the base it was computed with, so the next reader —
    // the UI, the CLI, or an agent — sees that it answers a different question
    // and scans instead of trusting it.
    review.invalidate(name);
    return c.json(session);
  });

  app.get("/api/export", async (c) => {
    const status = choice(c.req.query("status"), "status", ["open", "all"] as const, "open");
    const format = choice(c.req.query("format"), "format", ["md", "json"] as const, "md");
    const session = await resolveSessionName(config.dataDir, named(c));
    const comments = await list(config.dataDir, session, status === "all" ? {} : { status });
    if (format === "json") return c.json(comments);
    const metadata = await readSession(config.dataDir, session);
    return c.body(exportMarkdown(metadata, comments), 200, {
      "content-type": "text/markdown; charset=utf-8",
    });
  });

  // An unknown route under `/api` is a mistake, not a page of the UI.
  app.all("/api/*", (c) =>
    c.json({ error: "no-such-route", message: `no route ${new URL(c.req.url).pathname}` }, 404),
  );

  app.get("/*", async (c) => {
    const path = new URL(c.req.url).pathname;
    const asset =
      (await ui.read(path === "/" ? "index.html" : path)) ?? (await ui.read("index.html"));
    if (!asset) return c.text("UI is not built: run `bun run build:ui`", 404);
    return new Response(asset.body, { status: 200, headers: { "content-type": asset.type } });
  });

  app.onError(errorResponse);
  return app;
}
