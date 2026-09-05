import { createApp } from "../server/app.ts";
import type { UiAssets } from "../server/assets.ts";
import { buildReviewBundle } from "../server/review.ts";
import { startServer } from "../server/runtime.ts";
import { VERSION } from "./version.ts";

const USAGE = `diffalanche ${VERSION}

  diffalanche serve [--root <dir>] [--port <n>]   server and UI
  diffalanche version                             print the version
  diffalanche --help                              this text
`;

export type Output = { out: (text: string) => void; err: (text: string) => void };

/** The commands both delivery channels expose; the entry points only pick the UI assets. */
export async function run(argv: string[], ui: UiAssets, output: Output): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    output.out(USAGE);
    return 0;
  }
  if (command === "version" || command === "--version") {
    output.out(`${VERSION}\n`);
    return 0;
  }
  if (command === "serve") {
    if (rest.includes("--help") || rest.includes("-h")) {
      output.out(USAGE);
      return 0;
    }
    const root = flag(rest, "--root") ?? process.cwd();
    const port = Number(flag(rest, "--port") ?? 4880);
    const bundle = await buildReviewBundle(root);
    const server = await startServer(createApp({ bundle, ui }), port);
    output.out(
      `diffalanche ${VERSION} on http://127.0.0.1:${server.port}\n` +
        `  ${bundle.totals.repositories} repositories, ${bundle.totals.files} files, ` +
        `${bundle.totals.lines} changed lines\n`,
    );
    return 0;
  }

  output.err(`unknown command: ${command}\n\n${USAGE}`);
  return 1;
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}
