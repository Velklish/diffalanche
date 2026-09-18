import { defineConfig } from "vitest/config";
import { fixtureEnv } from "./src/core/config/index.ts";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The data directory can come from the developer's own environment and
    // `~/.config/diffalanche/config.json`; a test run must not (DA-54.1).
    env: fixtureEnv(),
  },
});
