/**
 * Starting the server: one call that scans the root, reads the change set,
 * begins watching, and opens the socket on `127.0.0.1`. `diffalanche serve` is
 * this function plus the built UI of its delivery channel.
 */
import type { Config } from "../core/config/index.ts";
import { DomainError } from "../core/domain/index.ts";
import { scan } from "../core/index.ts";
import { ensureDataDir } from "../core/storage/index.ts";
import type { Watcher } from "../core/watcher/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../core/watcher/index.ts";
import { createApp } from "./app.ts";
import type { UiAssets } from "./assets.ts";
import { createEventStream, forwardActivity, forwardEvents } from "./events.ts";
import type { ReviewService } from "./review.ts";
import { createReviewService } from "./review.ts";
import { startServer } from "./runtime.ts";

export type ReviewServerOptions = {
  config: Config;
  /** Request logging to stderr. */
  verbose?: boolean | undefined;
  /**
   * Where the built UI comes from: `directoryAssets` for the npm channel and
   * every run from source, `embeddedAssets` for a binary. Without it the page
   * is a 404 naming the command that builds it.
   */
  ui?: UiAssets | undefined;
  /**
   * `false` walks the reviewed trees instead of watching them, for a filesystem
   * whose notifications cannot be trusted ([05-watcher.md](../../docs/reference/05-watcher.md)).
   */
  recursive?: boolean | undefined;
};

export type ReviewServer = {
  /** The address to open, `http://127.0.0.1:<port>`. */
  url: string;
  port: number;
  /** The review behind the routes, for a harness that wants the numbers without a request. */
  review: ReviewService;
  close: () => Promise<void>;
};

const NO_UI: UiAssets = { read: async () => null };

/**
 * The server listens on `127.0.0.1` and nowhere else: there is no host to pass
 * and no way to reach it from another machine (`docs/SPEC.md` section 11).
 */
export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServer> {
  const { config } = options;
  await ensureDataDir(config.dataDir);
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });

  // The watcher is what keeps a session's `diff.json` fresh, so the service asks
  // it which session that is ([07-server.md](../../docs/reference/07-server.md)).
  let watcher: Watcher | null = null;
  const review = createReviewService(config, { watched: () => watcher?.session() ?? null });
  const bus = createEventBus();
  const events = createEventStream();
  const activity = createActivityLog({ onRecord: forwardActivity(events) });
  forwardEvents(bus, events);

  const running = await startWatcher({
    config,
    scan: found,
    ...(options.recursive === undefined ? {} : { recursive: options.recursive }),
    bus,
    activity,
    onRescan: review.adopt,
    onRepositoryChanged: review.repositoryChanged,
    // The tasks windows are open on, taken from the live streams rather than
    // from the document cache: a connection exists exactly while a window does,
    // and a cache's eviction answers a question about memory (05-watcher.md).
    sessions: () => events.sessions(),
    onError: (error) => {
      process.stderr.write(
        `rescan failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    },
    // The one word the operator gets about a session that has dropped to a walk
    // and will never meet the budget of `docs/SPEC.md` section 6 again.
    onFallback: () => {
      process.stderr.write(
        "the recursive watch failed: the trees are walked on a timer, and updates are slower\n",
      );
    },
  });
  watcher = running;
  // Nothing refreshed `diff.json` while no server ran, so the first document is not built from it:
  // one read of the current session's scope, queued ahead of any rescan (07-server.md).
  await running.refresh();
  // A rescan hands the change set to `adopt`, warnings and all, so neither of
  // its two events costs the next reader a re-read.
  bus.subscribe((event) => {
    if (event.type === "diff-changed" || event.type === "warnings") return;
    // A task that appeared or was closed elsewhere in the data directory is
    // news for the page, not for this document: the sessions are read per
    // request and the review the page is on has not changed.
    if (event.type === "sessions-changed") return;
    // `current` moving changes which document a bare request resolves to and
    // not what any document says, so nothing is dropped for it.
    if (event.type === "current-changed") return;
    if (event.type === "session-changed") {
      review.invalidate(event.name);
      return;
    }
    // The frame names the session its thread belongs to, and the watcher now
    // follows more than one ([05-watcher.md](../../docs/reference/05-watcher.md)).
    review.invalidateComments(event.session);
  });

  // The change set is read and `diff.json` written before the socket opens, so
  // the review opens from the cache and a rescan has something to replace one
  // repository of. This is a warm-up and not a gate: a root with no current
  // session has none of it and opens the first-run screen instead, and a file
  // that cannot be read is a refusal the request gets as its own answer — a
  // server that refused to start would leave the person with no way to see why.
  try {
    await review.document();
  } catch (error) {
    if (!(error instanceof DomainError)) {
      process.stderr.write(
        `the review could not be read: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  const app = createApp({
    activity,
    config,
    events,
    review,
    ui: options.ui ?? NO_UI,
    verbose: options.verbose,
  });

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(app, config.port);
  } catch (error) {
    await running.close();
    throw listenError(error, config.port);
  }

  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port,
    review,
    close: async () => {
      // The streams end first: a socket that waits for an open connection to
      // finish would wait for one that never does.
      events.close();
      await running.close();
      await server.close();
    },
  };
}

/** A socket the environment refused for a reason this file words: an answer and
 * not a fault, so the CLI gives it one line and exit 1 ([06-cli.md](../../docs/reference/06-cli.md)). */
export class ListenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListenError";
  }
}

/** A port that is taken is the one failure worth its own sentence. An errno this
 * function does not word is rethrown as it is, which is what exit code 2 is for. */
function listenError(error: unknown, port: number): Error {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "EADDRINUSE") {
    return new ListenError(
      `port ${port} is already in use: stop the diffalanche that holds it, or run with --port <n>`,
    );
  }
  if (code === "EACCES") {
    return new ListenError(
      `port ${port} is not allowed for this user: run with --port <n> above 1023`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
