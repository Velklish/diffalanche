/** `serve`: the review and the UI on `127.0.0.1` (`docs/SPEC.md` section 8). */
import { spawn } from "node:child_process";
import { DomainError } from "../../core/domain/index.ts";
import type { ReviewTotals } from "../../core/types.ts";
import { startReviewServer } from "../../server/serve.ts";
import { flag, noExtra, text } from "../args.ts";
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

/** The line under the address. Nothing it reads is a reason to end the run: the
 * server is already serving, and `serve` only exits non-zero before it starts. */
async function summary(
  server: { review: { document: (session?: string) => Promise<{ totals: ReviewTotals }> } },
  session: string | undefined,
) {
  try {
    const { totals } = await server.review.document(session);
    return (
      `  ${totals.repositories} repositories, ${totals.files} files, ` +
      `${totals.lines} changed lines\n`
    );
  } catch (error) {
    // A root with no current session is not a failure: the server serves the
    // screen that offers to create one.
    if (error instanceof DomainError) {
      return "  no current review session: create one with `diffalanche review new <name>`\n";
    }
    // The server wrote the file and the fault to stderr as it started, and the
    // address answers with them too; the remedy is not `review new`.
    return "  the review could not be read: the address above says which file and what is wrong in it\n";
  }
}

export const serve: Command = {
  spec: {
    name: "serve",
    about: "serve the review and the UI on 127.0.0.1",
    options: {
      port: { type: "string", value: "<n>", about: "the port to listen on; default: 4880" },
      open: { type: "boolean", about: "open the review in the browser" },
      verbose: { type: "boolean", about: "log every request to stderr" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    // Resolved before the socket opens, and only when the flag is there: a
    // misspelling must be refused, and `current` must not enter the address.
    const session = text(args, "review") === undefined ? undefined : await context.session();
    const config = await context.config();
    const server = await startReviewServer({
      config,
      ui: context.ui,
      verbose: flag(args, "verbose"),
    });

    const url = session === undefined ? server.url : `${server.url}/?review=${session}`;
    context.io.out(`diffalanche ${VERSION} on ${url}\n${await summary(server, session)}`);
    if (flag(args, "open")) openBrowser(url, context.io);
    return 0;
  },
};
