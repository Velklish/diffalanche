import { defineConfig } from "vitest/config";
import { fixtureEnv } from "./src/core/config/index.ts";

/** The files that load the embedding model: one at a time, after everything else (09-ml.md). */
const MODEL = ["tests/embed.test.ts", "tests/embedding-model.test.ts"];

export default defineConfig({
  test: {
    // The data directory can come from the developer's own environment and
    // `~/.config/diffalanche/config.json`; a test run must not (DA-54.1).
    env: fixtureEnv(),
    // A timeout is a deadline on a hang, not a budget: the defaults of 5 and 10 s failed work that
    // claims no time on a loaded machine (11-perf.md, "Waits").
    testTimeout: 60_000,
    hookTimeout: 120_000,
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/**/*.test.ts"], exclude: MODEL } },
      {
        extends: true,
        test: {
          name: "model",
          include: MODEL,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
