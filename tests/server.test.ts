import { describe, expect, it } from "vitest";
import type { ReviewBundle } from "../src/core/types.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { startServer } from "../src/server/runtime.ts";

const bundle: ReviewBundle = {
  root: "/tmp/root",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
};

const noUi: UiAssets = { read: async () => null };

describe("server", () => {
  // Vitest runs under Node, so this covers the Node half of the runtime switch.
  it("listens before it reports its port, and picks one when asked for port 0", async () => {
    const server = await startServer(createApp({ bundle, ui: noUi }), 0);
    try {
      expect(server.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${server.port}/api/review`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(bundle);
    } finally {
      await server.close();
    }
  });

  it("serves the UI placeholder text when the UI is not built", async () => {
    const server = await startServer(createApp({ bundle, ui: noUi }), 0);
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("UI is not built");
    } finally {
      await server.close();
    }
  });
});
