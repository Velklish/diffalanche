/**
 * Starting the server: one call that scans the root, reads the change set,
 * begins watching, and opens the socket on `127.0.0.1`. `diffalanche serve` is
 * this function plus the built UI of its delivery channel.
 */
import type { Config } from "../core/config/index.ts";
import { DomainError } from "../core/domain/index.ts";
import { scan } from "../core/index.ts";
import { ensureDataDir } from "../core/storage/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../core/watcher/index.ts";
import { createApp } from "./app.ts";
import type { UiAssets } from "./assets.ts";
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

  const review = createReviewService(config);
  const bus = createEventBus();
  const activity = createActivityLog();

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

  const watcher = await startWatcher({
    config,
    scan: found,
    bus,
    activity,
    onRescan: review.adopt,
    onError: (error) => {
      process.stderr.write(
        `rescan failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    },
  });
  // A rescan has already patched the document through `onRescan`. A comment
  // event changes one small file, and re-reading the whole change set for it
  // would charge the next reader of the review for every comment written.
  bus.subscribe((event) => {
    if (event.type === "diff-changed") return;
    if (event.type === "session-changed" || event.type === "warnings") review.invalidate();
    else review.invalidateComments();
  });

  const app = createApp({
    config,
    review,
    ui: options.ui ?? NO_UI,
    verbose: options.verbose,
  });

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer(app, config.port);
  } catch (error) {
    watcher.close();
    throw listenError(error, config.port);
  }

  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port,
    review,
    close: async () => {
      watcher.close();
      await server.close();
    },
  };
}

/** A port that is taken is the one failure worth its own sentence. */
function listenError(error: unknown, port: number): Error {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "EADDRINUSE") {
    return new Error(
      `port ${port} is already in use: stop the diffalanche that holds it, or run with --port <n>`,
    );
  }
  if (code === "EACCES") {
    return new Error(`port ${port} is not allowed for this user: run with --port <n> above 1023`);
  }
  return error instanceof Error ? error : new Error(String(error));
}
