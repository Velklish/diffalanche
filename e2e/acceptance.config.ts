import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";
import { BINARY, FIXTURE } from "./binary.ts";

/**
 * The acceptance suite: the criteria of `docs/SPEC.md` section 10, run against
 * the binary of the runner's own platform rather than against a dev server.
 * `bun run test:e2e` runs this config; `bun run test:ui` keeps the fast path of
 * `playwright.config.ts`, which builds the UI and serves it from the sources.
 *
 * The two share neither a fixture nor a port, but they do share `dist/`:
 * `scripts/build.ts` empties it before a build, and the dev server reads
 * `dist/ui` from disk on every request. So the two suites do not run at the same
 * time — a build here pulls the page out from under a `test:ui` in flight, and
 * `bun run build:ui` there replaces the chunks this one embedded.
 */

/**
 * A port nothing is listening on. Asked for synchronously, because a Playwright
 * config is read synchronously: a child process binds port 0, prints what the
 * operating system handed it, and exits. The window between that and the server
 * binding it is the window any `--port 0` scheme has.
 *
 * `stdout.write` and not `console.log`: the runner may be Bun, and Bun's
 * `console.log` colours a number with escape codes that `Number` then reads as
 * `NaN`.
 */
function freePort(): string {
  return execFileSync(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
    ],
    { encoding: "utf8" },
  ).trim();
}

/**
 * Whichever of the two it came from, it has to be a port. A `baseURL` of
 * `http://127.0.0.1:NaN` fails eleven tests without ever saying why, and an
 * empty `DIFFALANCHE_E2E_PORT` reads as `0`.
 */
function checked(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`not a port: ${JSON.stringify(value)}`);
  return port;
}

/**
 * Playwright reads this file once in its own process and once more in every
 * worker it forks. A port chosen on each of those reads is a different port
 * each time, and the workers then talk to nothing: the number is put in the
 * environment the first time, and the forks inherit it. Setting it by hand also
 * pins the port for a debugging run against a server already up.
 */
const PORT = checked(process.env.DIFFALANCHE_E2E_PORT ?? freePort());
process.env.DIFFALANCHE_E2E_PORT = String(PORT);

export default defineConfig({
  testDir: ".",
  testMatch: /acceptance\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  // In CI the run also lands in the job summary as one row per criterion, which
  // is what the `e2e` job reads this file for; `test-results/` is ignored, so
  // the report never reaches a commit.
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/acceptance.json" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1560, height: 900 },
  },
  webServer: {
    // Built, generated, and served in one command, in that order: the binary
    // carries the UI inside it, so there is no `build:ui` step here, and the
    // fixture is made from scratch because the suite writes comments into it.
    command: [
      "bun run build -- --target current",
      `rm -rf ${FIXTURE}`,
      `bun e2e/fixture.ts ${FIXTURE}`,
      `${BINARY} serve --root ${FIXTURE} --port ${PORT}`,
    ].join(" && "),
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/api/review`,
    // Off by default, so a run always builds and serves what it is about to
    // test. `DIFFALANCHE_E2E_REUSE=1` beside a pinned port attaches to a server
    // already up, which is how the suite is debugged without a rebuild between
    // rounds ([08-ui.md](../docs/reference/08-ui.md)).
    reuseExistingServer: process.env.DIFFALANCHE_E2E_REUSE === "1",
    // The binary is built here, and a cold compile of the whole bundle is the
    // slowest thing in the run.
    timeout: 300_000,
  },
});
