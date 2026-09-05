import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The data directory can come from the developer's own environment and
    // `~/.config/diffalanche/config.json`; a test run must not: an empty
    // variable counts as unset, and the configuration home is a directory
    // nothing writes to.
    env: {
      DIFFALANCHE_DATA_DIR: "",
      XDG_CONFIG_HOME: join(tmpdir(), "diffalanche-tests-config-home"),
    },
  },
});
