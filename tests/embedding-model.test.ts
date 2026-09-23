/** The tests that need the model: the "model" project of vitest.config.ts, one file at a time
 * after every other file, one copy of the model resident at once (09-ml.md, "Tests"). */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { run } from "../src/cli/run.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment } from "../src/core/domain/index.ts";
import { defaultCacheHome, modelDirectory } from "../src/core/ml/embed/cache.ts";
import { type Embedder, embedder } from "../src/core/ml/embed/embedder.ts";
import { ModelError } from "../src/core/ml/embed/errors.ts";
import { EMBEDDING_MODEL } from "../src/core/ml/embed/model.ts";
import { startThreadedEmbedder } from "../src/core/ml/embed/threaded.ts";
import { nearest, updateIndex } from "../src/core/ml/index/index.ts";
import { dataDirOf, listSessionNames, readComments } from "../src/core/storage/index.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";

const noUi: UiAssets = { read: async () => null };
const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
const THREAD_TEXTS = ["Unused import.", "Нет ограничения на размер загружаемого файла."];

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await run(argv, noUi, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/** Taken on the thread before this process loads a copy of its own, and compared below. */
let fromThread: Float32Array[] = [];

describe("the embedder on a thread of its own", () => {
  it("embeds, and refuses every call once it is closed", async () => {
    const threaded = await startThreadedEmbedder(location);
    try {
      fromThread = await threaded.embed(THREAD_TEXTS);
      expect(fromThread.map((vector) => vector.length)).toEqual([384, 384]);
    } finally {
      await threaded.close();
    }
    await expect(threaded.embed(["after close"])).rejects.toThrow(/the embedding thread has ended/);
  }, 120_000);

  it("refuses to start on a directory without the model", async () => {
    const empty = mkdtempSync(join(tmpdir(), "diffalanche-no-model-"));
    try {
      await expect(startThreadedEmbedder(empty)).rejects.toThrow(ModelError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the index with the model", () => {
  const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
  let root: string;
  let dataDir: string;
  let model: Embedder;

  beforeAll(async () => {
    model = await embedder(location);
    root = mkdtempSync(join(tmpdir(), "diffalanche-index-model-"));
    generate({ out: root, seed: 11, profile: PROFILES.small });
    dataDir = dataDirOf(root);
  }, 180_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("gives from scratch the vectors the incremental updates gave, byte for byte", async () => {
    const [session] = (await listSessionNames(dataDir)).names;
    await updateIndex(dataDir, model);
    await addComment(dataDir, session as string, {
      severity: "warning",
      body: "The retry loop never sleeps between attempts, so it hammers the database.",
      author: "claude",
      role: "agent",
    });
    const incremental = (await updateIndex(dataDir, model)).index;
    expect(incremental.entries).toHaveLength(PROFILES.small.comments + 1);
    const rebuilt = (await updateIndex(dataDir, model, { rebuild: true })).index;
    expect(rebuilt.entries).toEqual(incremental.entries);
    expect(
      Buffer.from(rebuilt.vectors.buffer).equals(Buffer.from(incremental.vectors.buffer)),
    ).toBe(true);
  }, 120_000);

  it("finds a comment written by the CLI with no server running first, from a paraphrase", async () => {
    await updateIndex(dataDir, model);
    const written = await cli(
      "comment",
      "--severity",
      "critical",
      "--body",
      "The password is written to the log in plain text.",
      "--root",
      root,
      "--data-dir",
      dataDir,
    );
    expect(written.code, written.err).toBe(0);
    const { index, update } = await updateIndex(dataDir, model);
    expect(update.embedded).toBe(1);
    const [query] = await model.embed(["Пароль пишется в лог открытым текстом."]);
    const [first] = nearest(index, query as Float32Array, { k: 5 });
    expect(first).toMatchObject({
      body: "The password is written to the log in plain text.",
      severity: "critical",
    });
  }, 120_000);

  it("finds a comment written through the server first, from a paraphrase", async () => {
    await updateIndex(dataDir, model);
    const config = await loadConfig({ root });
    const app = createApp({
      activity: createActivityLog(),
      config,
      events: createEventStream(),
      review: createReviewService(config),
      ui: noUi,
    });
    const response = await app.request("/api/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        severity: "warning",
        body: "This query runs once per row: an N+1 against the orders table.",
      }),
    });
    expect(response.status).toBe(201);
    const { index, update } = await updateIndex(dataDir, model);
    expect(update.embedded).toBe(1);
    const [query] = await model.embed([
      "Each row triggers its own select on orders — classic N+1.",
    ]);
    const [first] = nearest(index, query as Float32Array, { k: 5 });
    expect(first?.body).toBe("This query runs once per row: an N+1 against the orders table.");
  }, 120_000);

  it("rebuilds from the CLI and says how much it indexed", async () => {
    const [session] = (await listSessionNames(dataDir)).names;
    const total = (await readComments(dataDir, session as string)).length;
    const { code, out } = await cli("index", "rebuild", "--root", root, "--data-dir", dataDir);
    expect(code).toBe(0);
    expect(out).toMatch(
      new RegExp(`^indexed ${total} comments of 1 review session in \\d+\\.\\d s\n$`),
    );
    expect((await cli("index", "status", "--data-dir", dataDir)).out).toContain(
      "state     current",
    );
  }, 120_000);

  it("gives on a thread of its own the bytes it gives on the calling thread", async () => {
    const here = await model.embed(THREAD_TEXTS);
    THREAD_TEXTS.forEach((text, i) => {
      const there = fromThread[i];
      if (there === undefined)
        throw new Error("run the whole file: its first test fills fromThread");
      expect(
        Buffer.from(there.buffer).equals(Buffer.from((here[i] as Float32Array).buffer)),
        text,
      ).toBe(true);
    });
  }, 60_000);
});
