import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewBundle } from "../src/core/types.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { buildReviewBundle } from "../src/server/review.ts";
import { startServer } from "../src/server/runtime.ts";

const bundle: ReviewBundle = {
  root: "/tmp/root",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
  warnings: [],
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

/**
 * The stopgap that hands the UI the current session until DA-16 puts the
 * storage behind it. What matters is that a root without a session, or with a
 * broken one, still opens.
 */
describe("the current session on disk", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "diffalanche-session-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Writes one session directory and returns its name. */
  async function session(name: string, review: string, comments: string): Promise<string> {
    const dir = join(root, ".diffalanche", "reviews", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "review.json"), review);
    await writeFile(join(dir, "comments.json"), comments);
    return name;
  }

  const review = (name: string) =>
    JSON.stringify({ version: 1, name, title: "t", base: { mode: "head" } });
  const comments = (id: string) => JSON.stringify({ version: 1, comments: [{ id }] });

  it("reads the session the current pointer names", async () => {
    await session("one", review("one"), comments("c_1"));
    await session("two", review("two"), comments("c_2"));
    await writeFile(join(root, ".diffalanche", "current"), "two\n");

    const bundle = await buildReviewBundle(root);

    expect(bundle.session).toMatchObject({ name: "two" });
    expect(bundle.comments).toEqual([{ id: "c_2" }]);
    expect(bundle.warnings).toEqual([]);
  });

  it("falls back to the only session when there is no pointer", async () => {
    await session("only", review("only"), comments("c_9"));

    const bundle = await buildReviewBundle(root);

    expect(bundle.session).toMatchObject({ name: "only" });
    expect(bundle.comments).toEqual([{ id: "c_9" }]);
  });

  it("has no session when there is no pointer and more than one directory", async () => {
    await session("one", review("one"), comments("c_1"));
    await session("two", review("two"), comments("c_2"));

    const bundle = await buildReviewBundle(root);

    expect(bundle.session).toBeNull();
    expect(bundle.comments).toEqual([]);
  });

  it("has no session when the data directory is missing", async () => {
    const bundle = await buildReviewBundle(root);

    expect(bundle.session).toBeNull();
    expect(bundle.comments).toEqual([]);
  });

  it("survives a session whose files are missing or broken", async () => {
    await mkdir(join(root, ".diffalanche", "reviews", "half"), { recursive: true });
    let bundle = await buildReviewBundle(root);
    expect(bundle.session).toBeNull();
    expect(bundle.comments).toEqual([]);

    await session("half", "{ not json", "{ not json either");
    bundle = await buildReviewBundle(root);
    expect(bundle.session).toBeNull();
    expect(bundle.comments).toEqual([]);
  });

  it("refuses a pointer that is a path rather than a session name", async () => {
    // The path resolves to a real session, so only the check can refuse it.
    await session("only", review("only"), comments("c_9"));
    await writeFile(join(root, ".diffalanche", "current"), "../reviews/only\n");

    const bundle = await buildReviewBundle(root);

    expect(bundle.session).toBeNull();
  });
});
