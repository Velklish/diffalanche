/** `serve`: the review and the UI on `127.0.0.1` (`docs/SPEC.md` section 8). */
import { spawn } from "node:child_process";
import { createApp } from "../../server/app.ts";
import { buildReviewBundle } from "../../server/review.ts";
import { startServer } from "../../server/runtime.ts";
import { flag, noExtra } from "../args.ts";
import type { Command } from "../command.ts";
import type { Output } from "../output.ts";
import { VERSION } from "../version.ts";

/**
 * Opens the review in the browser through the platform's own opener, detached
 * and with its output dropped: the server holds the foreground, and an opener
 * that writes to the terminal would land in the middle of the review's output.
 * A machine without one is not a failed run — the URL is printed either way.
 */
function openBrowser(url: string, io: Output): void {
  const opener =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };
  const child = spawn(opener.file, opener.args, { stdio: "ignore", detached: true });
  child.on("error", (error) => {
    io.err(`could not open the browser with ${opener.file}: ${error.message}\n`);
  });
  child.unref();
}

export const serve: Command = {
  spec: {
    name: "serve",
    about:
      "serve the review and the UI on 127.0.0.1; until the server of DA-16 it scans " +
      "against HEAD and reads no review session",
    options: {
      port: { type: "string", value: "<n>", about: "the port to listen on; default: 4880" },
      open: { type: "boolean", about: "open the review in the browser" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const config = await context.config();
    // DA-16 replaces these three lines with `startReviewServer({ config, verbose })`
    // from `src/server/index.ts`: the server then reads the session's base and
    // owns its own scan. Until it is on `main` this is the Phase 0 spike server,
    // which always reads the working tree against HEAD.
    const bundle = await buildReviewBundle(config.root);
    const server = await startServer(createApp({ bundle, ui: context.ui }), config.port);

    const url = `http://127.0.0.1:${server.port}`;
    context.io.out(
      `diffalanche ${VERSION} on ${url}\n` +
        `  ${bundle.totals.repositories} repositories, ${bundle.totals.files} files, ` +
        `${bundle.totals.lines} changed lines\n`,
    );
    if (flag(args, "open")) openBrowser(url, context.io);
    return 0;
  },
};
