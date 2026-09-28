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

/** The UI tests, Playwright over the built page and outside Vitest; the baselines beside the spec
 * are the shell's approved look, over the seeded small profile (08-ui.md, "UI tests"). */
export default defineConfig({
  testDir: ".",
  // The acceptance list has its own config, fixture and binary; without this the directory scan
  // would run it here against the dev server over the wrong fixture.
  testIgnore: /acceptance\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1560, height: 900 },
  },
  webServer: {
    // From scratch every run: the specs write comments and replies into it, and a suite that
    // reads what the last run left fails on its own residue.
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
