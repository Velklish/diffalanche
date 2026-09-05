import { Hono } from "hono";
import type { ReviewBundle } from "../core/types.ts";
import type { UiAssets } from "./assets.ts";

export type AppOptions = {
  bundle: ReviewBundle;
  ui: UiAssets;
};

/**
 * The spike server: the whole review as one response plus the built UI. Routes
 * for comments, sessions, and the SSE stream belong to the Phase 1 tasks.
 */
export function createApp({ bundle, ui }: AppOptions): Hono {
  const app = new Hono();
  // Serialised once: the review is megabytes and every request would pay for it again.
  const payload = JSON.stringify(bundle);

  app.get("/api/review", (c) => c.body(payload, 200, { "content-type": "application/json" }));

  app.get("/*", async (c) => {
    const path = new URL(c.req.url).pathname;
    const asset =
      (await ui.read(path === "/" ? "index.html" : path)) ?? (await ui.read("index.html"));
    if (!asset) return c.text("UI is not built: run `bun run build:ui`", 404);
    return new Response(asset.body, { status: 200, headers: { "content-type": asset.type } });
  });

  return app;
}
