import type { Context } from "hono";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { findRepositories, refreshRepository } from "../core/change-set.ts";
import type { Config } from "../core/config/index.ts";
import type { FileSource } from "../core/domain/index.ts";
import {
  addComment,
  assertScope,
  closeSession,
  createSession,
  deleteSession,
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
  severitySource,
  side,
  text,
} from "./request.ts";
import type { ReviewService } from "./review.ts";
import { listBranches } from "./routes/branches.ts";
import { fileRoute, fileSource, treeRoute } from "./routes/browse.ts";
import { symbolIndexOf, symbolRoute, textRoute } from "./routes/search.ts";
import type { SuggestService } from "./suggest.ts";
import { createSuggestService } from "./suggest.ts";

type AppOptions = {
  config: Config;
  review: ReviewService;
  ui: UiAssets;
  /** The live stream `/api/events` serves. */
  events: EventStream;
  /** The feed the stream's `activity` frames are recorded in. */
  activity: ActivityLog;
  /** Request logging to stderr. Off unless `serve` was given `--verbose`. */
  verbose?: boolean | undefined;
  /** Where `GET /api/suggest` embeds; one of the data directory's own without it. */
  suggest?: SuggestService | undefined;
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

/** The task a request is about, `?review=<name>` or else `current`: every route a window uses
 * reads it, writes too (07-server.md, "The task a request is about"; ADR-010, decision 7). */
function named(c: Context): string | undefined {
  const name = c.req.query("review");
  return name === undefined || name === "" ? undefined : name;
}

/** What `GET /api/config` gives the UI: the two settings it has to know. */
type ClientConfig = { user: string; port: number };

/** The suggestion service of each app, for the server's `close` to end its process. */
const services = new WeakMap<Hono, SuggestService>();

export async function closeApp(app: Hono): Promise<void> {
  await services.get(app)?.close();
}

/** The server of `docs/reference/07-server.md`: the review, the sessions, the settings, the built
 * UI; every refusal keeps the domain's message ([errors.ts](errors.ts)). */
export function createApp({
  activity,
  config,
  events,
  review,
  ui,
  verbose,
  suggest,
}: AppOptions): Hono {
  const app = new Hono();
  const suggestions = suggest ?? createSuggestService(config.dataDir);
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

  // Serialised once per change, not per request: the review is megabytes; `?review=` is the
  // task an agent printed a link to ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
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

  // The whole root against the task's base, for the scope editor: the one answer about what is
  // outside a scope, and names only (07-server.md, "The candidates").
  app.get("/api/sessions/candidates", async (c) => c.json(await review.candidates(named(c))));

  app.get("/api/config", (c) => c.json<ClientConfig>({ user: config.user, port: config.port }));

  // Every branch the base picker offers, read from git per request: there is no cache of refs,
  // and the picker is opened by hand rather than on every reload.
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

  // What the feed shows before anything happens, in the shape of the `activity` frames; held in
  // memory only ([ADR-005](../../docs/adr/adr-005-live-update.md), 07-server.md "The live stream").
  app.get("/api/activity", (c) => c.json(activity.recent()));

  // Past comments like the one being written, from every session, and the severity they
  // vote for; the first request starts the model ([07-server.md](../../docs/reference/07-server.md)).
  app.get("/api/suggest", async (c) => {
    const body = c.req.query("body");
    if (body === undefined || body.trim() === "") throw new RequestError("body is required");
    return c.json(await suggestions.suggest(body));
  });

  // Every repository under the root and whether it has anything to review, read from git per
  // request: it is for the screen shown before there is a session, with no cache to answer.
  app.get("/api/scan", async (c) => c.json(await review.summary()));

  // Every write is signed as the configured user with `role: human`, since the CLI is where an
  // agent writes (ADR-004); its events come from the watcher (07-server.md, "Writing").

  app.post("/api/comments", async (c) => {
    const body = await readBody(c);
    const session = await resolveSessionName(config.dataDir, named(c));
    const repo = nullableText(body, "repo");
    const path = nullableText(body, "path");
    // A repository the root has; the anchor comes from the change set as shown, not a new read,
    // and the scope is the domain's check (07-server.md, "Writing").
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
        severitySource: severitySource(body),
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
    c.json(await verdict(c, c.req.param("id"), reopen, true)),
  );

  /** The repository of a line comment read into its task's `diff.json` again; nothing for one
   * above a line, and nothing for an id the reopen will refuse by itself. */
  async function refreshFor(session: string, id: string): Promise<void> {
    const found = await getComment(config.dataDir, session, id).catch(() => null);
    if (found === null || found.repo === null || found.path === null || found.line === null) return;
    const task = await readSession(config.dataDir, session);
    await refreshRepository(config, session, task.base, found.repo, task.scope);
  }

  /** `resolve` and `reopen` differ only in which of them is called. */
  async function verdict(
    c: Context,
    id: string,
    close: (
      dataDir: string,
      session: string,
      id: string,
      given: { author: string; role: Role; note?: string },
      options: { source: FileSource },
    ) => Promise<Comment>,
    refresh = false,
  ): Promise<Comment> {
    const body = await readBody(c);
    const note = optionalText(body, "note");
    const session = await resolveSessionName(config.dataDir, named(c));
    // A reopen reads the repository again first, as the CLI's does, a task nobody rescans too:
    // the comments move with the rewrite, and the thread is judged where it is now.
    if (refresh) await refreshFor(session, id);
    // The source lets `reopen` judge whether a line comment's anchor still reads at its line.
    const comment = await close(
      config.dataDir,
      session,
      id,
      { ...author, ...(note === undefined ? {} : { note }) },
      { source: fileSource(config) },
    );
    review.invalidateComments(session);
    return comment;
  }

  // A task made in one write, scope included; `use: false` is `review new --no-use`
  // (07-server.md, "Writing"; [ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
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

  // Replaced whole, one write one state; dropping comments needs `dropComments` or it is a 409
  // that writes nothing (07-server.md, "Writing"; ADR-010).
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
    // Signed as the configured user with `role: human`, which nothing in the request can change:
    // only a human closes a task ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
    const session = await closeSession(config.dataDir, c.req.param("name"), author);
    review.invalidate(session.name);
    return c.json(session);
  });

  app.post("/api/sessions/:name/reopen", async (c) => {
    const session = await reopenSession(config.dataDir, c.req.param("name"), author);
    review.invalidate(session.name);
    return c.json(session);
  });

  // Deleted by the human the UI is, and nothing held for it stays: a document of a task that is
  // gone would be served to a window that still names it (DA-40, 07-server.md).
  app.delete("/api/sessions/:name", async (c) => {
    const name = c.req.param("name");
    const deleted = await deleteSession(config.dataDir, name, author);
    review.forget(name);
    return c.json({ name, ...deleted });
  });

  app.put("/api/sessions/:name/base", async (c) => {
    const body = await readBody(c);
    const name = c.req.param("name");
    const session = await setBase(config.dataDir, name, parseBaseArgument(text(body, "base")));
    // `diff.json` records the base it was computed with, so the next reader sees it answers
    // another question and scans instead of trusting it.
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
  services.set(app, suggestions);
  return app;
}
