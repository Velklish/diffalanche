import { defineConfig } from "@playwright/test";

const PORT = 4881;

/**
 * The UI tests: Playwright drives the built page, so they are not part of
 * `bun run test` (Vitest). `bun run test:ui` runs them; the baselines next to
 * the spec are the approved look of the shell. The fixture is the small profile
 * of the synthetic review, which is deterministic for a given seed.
 */
export default defineConfig({
  testDir: ".",
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
    url: `http://127.0.0.1:${PORT}/api/review`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
