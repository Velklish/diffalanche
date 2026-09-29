import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";
import { fixtureEnv } from "../src/core/config/index.ts";

/** The acceptance suite, section 10 against the binary; it shares `dist/` with `test:ui`, so the
 * two never run at once (08-ui.md, "The acceptance suite"). */

/** A free port, asked for synchronously because the config is read so; `stdout.write` because
 * Bun's `console.log` colours the number (08-ui.md, "A free port for a suite"). */
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

/** Either source has to give a port: `127.0.0.1:NaN` fails every test without saying why, and an
 * empty `DIFFALANCHE_E2E_PORT` reads as `0`. */
function checked(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`not a port: ${JSON.stringify(value)}`);
  return port;
}

/** Playwright reads this file in its own process and in every worker: the first read pins the
 * port for the forks to inherit, and setting it by hand pins it for a debugging run. */
const PORT = checked(process.env.DIFFALANCHE_E2E_PORT ?? freePort());
process.env.DIFFALANCHE_E2E_PORT = String(PORT);

// Neither the developer's shell nor their user config may name the fixture's
// data directory — the binary reads it, and so does every CLI a spec runs.
Object.assign(process.env, fixtureEnv());

export default defineConfig({
  testDir: ".",
  testMatch: /acceptance\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  // In CI the `e2e` job turns this report into one summary row per criterion; `test-results/` is
  // git-ignored, so the report never reaches a commit.
  reporter: process.env.CI
    ? [["list"], ["json", { outputFile: "test-results/acceptance.json" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1560, height: 900 },
  },
  webServer: {
    // Built, generated and served by one script rather than a shell line, which Windows' shell
    // does not read (`e2e/serve-acceptance.ts`, 08-ui.md "The acceptance suite").
    command: `bun e2e/serve-acceptance.ts ${PORT}`,
    cwd: "..",
    // The page, not `/api/review`: that route answers 404 whenever the data
    // directory resolved away from the fixture, and the wait reads as a hang.
    url: `http://127.0.0.1:${PORT}/`,
    // Off by default, so a run tests what it just built; `DIFFALANCHE_E2E_REUSE=1` beside a pinned
    // port attaches to a server already up ([08-ui.md](../docs/reference/08-ui.md)).
    reuseExistingServer: process.env.DIFFALANCHE_E2E_REUSE === "1",
    // The binary is built here, and a cold compile of the whole bundle is the
    // slowest thing in the run.
    timeout: 300_000,
  },
});
