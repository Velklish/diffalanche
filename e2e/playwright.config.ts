import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";
import { fixtureEnv } from "../src/core/config/index.ts";

/** A free port, chosen as `acceptance.config.ts` chooses one and for the same
 * reason; why this suite cannot hold a fixed one is in `08-ui.md`. */
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

/** Playwright reads this file once per worker it forks; the first read pins it. */
const PORT = Number(process.env.DIFFALANCHE_UI_PORT ?? freePort());
if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error(`not a port: ${JSON.stringify(process.env.DIFFALANCHE_UI_PORT)}`);
}
process.env.DIFFALANCHE_UI_PORT = String(PORT);

// Neither the developer's shell nor their user config may name the fixture's
// data directory — the server reads it, and so does every CLI a spec runs.
Object.assign(process.env, fixtureEnv());

/**
 * The UI tests: Playwright drives the built page, so they are not part of
 * `bun run test` (Vitest). `bun run test:ui` runs them; the baselines next to
 * the spec are the approved look of the shell. The fixture is the small profile
 * of the synthetic review, which is deterministic for a given seed.
 */
export default defineConfig({
  testDir: ".",
  // The acceptance list has its own configuration, its own fixture and its own
  // server — the binary (`e2e/acceptance.config.ts`). Without this line the
  // directory scan would collect it here too and run it against the dev server
  // over the wrong fixture.
  testIgnore: /acceptance\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1560, height: 900 },
  },
  webServer: {
    // The fixture is made from scratch every run: the specs write comments and
    // replies into it, the generator does not clear what it finds, and a suite
    // that reads what the last run left is a suite that fails on its own
    // residue.
    command:
      "bun run build:ui && rm -rf .perf/e2e && bun run synth -- --out .perf/e2e --small && bun e2e/server.ts",
    cwd: "..",
    // `e2e/server.ts` reads `PORT`; without this it would keep its own default
    // and the suite would wait on a port nothing bound.
    env: { PORT: String(PORT) },
    // The page, not `/api/review`: that route answers 404 whenever the data
    // directory resolved away from the fixture, and the wait reads as a hang.
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
