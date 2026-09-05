import type { Context } from "hono";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { findRepositories } from "../core/change-set.ts";
import type { Config } from "../core/config/index.ts";
import {
  addComment,
  createSession,
  exportMarkdown,
  list,
  listSessions,
  parseBaseArgument,
  readSession,
  reopen,
  reply,
  resolve,
  resolveSessionName,
  setBase,
  useSession,
} from "../core/domain/index.ts";
import type { Comment, Role } from "../core/storage/index.ts";
import type { UiAssets } from "./assets.ts";
import { errorResponse, ForbiddenError, RequestError } from "./errors.ts";
import {
  choice,
  nullableLine,
  nullableText,
  optionalText,
  readBody,
  severity,
  side,
  text,
} from "./request.ts";
import type { ReviewService } from "./review.ts";

export type AppOptions = {
  config: Config;
  review: ReviewService;
  ui: UiAssets;
  /** Request logging to stderr. Off unless `serve` was given `--verbose`. */
  verbose?: boolean | undefined;
};

/** The methods that change nothing, and so need no guard on where they came from. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** What `GET /api/config` gives the UI: the two settings it has to know. */
export type ClientConfig = { user: string; port: number };

/**
 * The server of `docs/reference/07-server.md`: the review in one response, the
 * sessions, the settings, and the built UI. Every refusal comes from the domain
 * and keeps its message ([errors.ts](errors.ts)).
 */
export function createApp({ config, review, ui, verbose }: AppOptions): Hono {
  const app = new Hono();
  /** What the UI signs with: the configured name, and never an agent's role. */
  const author = { author: config.user, role: "human" as Role };

  // Two guards on the same question, because the server has no authentication
  // and no other check on who is writing (`docs/SPEC.md` section 11). `csrf()`
  // refuses the writes a page on another origin can send without this server
  // being asked first — a form post, a `text/plain` post — by `Sec-Fetch-Site`
  // and `Origin`. The second refuses any write that names another origin at
  // all, which is what a JSON write from such a page would carry if a browser
  // ever let it through. A request with no `Origin` is not from a page.
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

  // Serialised once per change, not once per request: the review is megabytes.
  app.get("/api/review", async (c) =>
    c.body(await review.payload(), 200, { "content-type": "application/json" }),
  );

  app.get("/api/sessions", async (c) => c.json(await listSessions(config.dataDir)));

  app.get("/api/config", (c) => c.json<ClientConfig>({ user: config.user, port: config.port }));

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
  // turns the file that changed into the events the UI listens for; the
  // document is dropped here as well, so the next read of it is the new state
  // and not the state of a moment ago.

  app.post("/api/comments", async (c) => {
    const body = await readBody(c);
    const session = await resolveSessionName(config.dataDir);
    const repo = nullableText(body, "repo");
    // A comment names a repository the root has; the anchor is taken from the
    // change set as it was shown, and the repository is not read again for it.
    if (repo !== null && !(await findRepositories(config)).includes(repo)) {
      throw new RequestError(`repo ${repo} is not a repository under the root`);
    }
    const comment = await addComment(config.dataDir, session, {
      repo,
      path: nullableText(body, "path"),
      line: nullableLine(body, "line"),
      endLine: nullableLine(body, "endLine"),
      side: side(body),
      severity: severity(body),
      body: text(body, "body"),
      ...author,
    });
    review.invalidate();
    return c.json(comment, 201);
  });

  app.post("/api/comments/:id/replies", async (c) => {
    const body = await readBody(c);
    const session = await resolveSessionName(config.dataDir);
    const comment = await reply(config.dataDir, session, c.req.param("id"), {
      body: text(body, "body"),
      ...author,
    });
    review.invalidate();
    return c.json(comment, 201);
  });

  app.post("/api/comments/:id/resolve", async (c) => {
    const comment = await verdict(c, c.req.param("id"), resolve);
    review.invalidate();
    return c.json(comment);
  });

  app.post("/api/comments/:id/reopen", async (c) => {
    const comment = await verdict(c, c.req.param("id"), reopen);
    review.invalidate();
    return c.json(comment);
  });

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
    const session = await resolveSessionName(config.dataDir);
    return close(config.dataDir, session, id, {
      ...author,
      ...(note === undefined ? {} : { note }),
    });
  }

  app.post("/api/sessions", async (c) => {
    const body = await readBody(c);
    const base = parseBaseArgument(optionalText(body, "base") ?? "head");
    const title = optionalText(body, "title");
    const created = await createSession(config.dataDir, text(body, "name"), base, title);
    review.invalidate();
    return c.json(created, 201);
  });

  app.post("/api/sessions/:name/use", async (c) => {
    const session = await useSession(config.dataDir, c.req.param("name"));
    review.invalidate();
    return c.json(session);
  });

  app.put("/api/sessions/:name/base", async (c) => {
    const body = await readBody(c);
    const name = c.req.param("name");
    const session = await setBase(config.dataDir, name, parseBaseArgument(text(body, "base")));
    // `diff.json` records the base it was computed with, so the next reader —
    // the UI, the CLI, or an agent — sees that it answers a different question
    // and scans instead of trusting it.
    review.invalidate();
    return c.json(session);
  });

  app.get("/api/export", async (c) => {
    const status = choice(c.req.query("status"), "status", ["open", "all"] as const, "open");
    const format = choice(c.req.query("format"), "format", ["md", "json"] as const, "md");
    const session = await resolveSessionName(config.dataDir);
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
