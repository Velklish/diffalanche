/** The tests that need the model: the "model" project of vitest.config.ts, one file at a time
 * after every other file, one copy of the model resident at once (09-ml.md, "Tests"). */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { run } from "../src/cli/run.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment } from "../src/core/domain/index.ts";
import { defaultCacheHome, modelDirectory } from "../src/core/ml/embed/cache.ts";
import { type Embedder, embedder } from "../src/core/ml/embed/embedder.ts";
import { ModelError } from "../src/core/ml/embed/errors.ts";
import { EMBEDDING_MODEL } from "../src/core/ml/embed/model.ts";
import { openEmbedder } from "../src/core/ml/embed/open.ts";
import { startSpawnedEmbedder } from "../src/core/ml/embed/spawned.ts";
import { nearest, updateIndex } from "../src/core/ml/index/index.ts";
import { NEIGHBOURS, suggest } from "../src/core/ml/suggest/index.ts";
import { dataDirOf, listSessionNames, readComments } from "../src/core/storage/index.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";
import { createSuggestService } from "../src/server/suggest.ts";

const noUi: UiAssets = { read: async () => null };
const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
const PROCESS_TEXTS = ["Unused import.", "Нет ограничения на размер загружаемого файла."];
const execFileAsync = promisify(execFile);

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

/** Taken from the process before this one loads a copy of its own, and compared below. */
let fromProcess: Float32Array[] = [];

describe("the embedder in a process of its own", () => {
  it("embeds, and refuses every call once it is closed", async () => {
    const spawned = await startSpawnedEmbedder(location);
    try {
      fromProcess = await spawned.embed(PROCESS_TEXTS);
      expect(fromProcess.map((vector) => vector.length)).toEqual([384, 384]);
    } finally {
      await spawned.close();
    }
    await expect(spawned.embed(["after close"])).rejects.toThrow(/the embedding process has ended/);
  }, 120_000);

  it("keeps the model out of the process that asks for vectors", async () => {
    const before = process.memoryUsage().rss;
    const spawned = await openEmbedder(location);
    try {
      expect((await spawned.embed(PROCESS_TEXTS)).map((vector) => vector.length)).toEqual([
        384, 384,
      ]);
      // The model is 476–714 MiB resident wherever it loads (09-ml.md): there, and not here.
      expect(process.memoryUsage().rss - before).toBeLessThan(200 * 2 ** 20);
    } finally {
      await spawned.close();
    }
  }, 120_000);

  it("ends with a command that never closes it", async () => {
    const helper = fileURLToPath(new URL("./helpers/unclosed-embedder.ts", import.meta.url));
    const { stdout } = await execFileAsync(process.execPath, [helper], { timeout: 120_000 });
    const pid = Number(stdout.trim());
    expect(pid).toBeGreaterThan(0);
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await vi.waitFor(() => expect(alive()).toBe(false), { timeout: 30_000, interval: 100 });
  }, 180_000);

  it("answers GET /api/suggest from the process within 100 ms once it is warm", async () => {
    const root = mkdtempSync(join(tmpdir(), "diffalanche-suggest-api-"));
    generate({ out: root, seed: 5, profile: PROFILES.small });
    const config = await loadConfig({ root });
    // The server's own: the user cache's model in a process of its own.
    const service = createSuggestService(config.dataDir);
    const app = createApp({
      activity: createActivityLog(),
      config,
      events: createEventStream(),
      review: createReviewService(config),
      ui: noUi,
      suggest: service,
    });
    const ask = (body: string) => app.request(`/api/suggest?body=${encodeURIComponent(body)}`);
    try {
      // The first request starts the process and indexes the review: that is not "warm".
      expect((await ask("warm-up")).status).toBe(200);
      const times: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        const started = performance.now();
        const response = await ask(`The cache key leaves out the region, case ${i}.`);
        times.push(performance.now() - started);
        expect(response.status).toBe(200);
      }
      // The median of seven: one request the machine took away is not the route's time.
      expect(times.sort((a, b) => a - b)[3]).toBeLessThan(100);
    } finally {
      await service.close();
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);

  it("refuses to start on a directory without the model", async () => {
    const empty = mkdtempSync(join(tmpdir(), "diffalanche-no-model-"));
    try {
      await expect(startSpawnedEmbedder(empty)).rejects.toThrow(ModelError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the index with the model", () => {
  const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
  let root: string;
  let dataDir: string;
  /** Loaded by the first test that embeds here, after the two that start the model's process
   * through the CLI: one copy of the model at a time (09-ml.md, "Tests"). */
  let loaded: Promise<Embedder> | null = null;
  const inThisProcess = () => {
    loaded ??= embedder(location);
    return loaded;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "diffalanche-index-model-"));
    generate({ out: root, seed: 11, profile: PROFILES.small });
    dataDir = dataDirOf(root);
  }, 180_000);

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

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

  it("prints the suggestions with their sources and the severity, and the same as JSON", async () => {
    const body = "The cache key does not include the region, so two tariffs overwrite each other.";
    const text = await cli("suggest", "--body", body, "--root", root, "--data-dir", dataDir);
    expect(text.code, text.err).toBe(0);
    expect(text.out).toMatch(/^severity {2}critical, confidence \d\.\d\d\n\n/);
    expect(text.out).toMatch(
      /\n0\.\d\d {2}critical {2}synth {2}\S+.* {2}Missing the region in the cache key: two tariffs collide here\./,
    );
    const json = await cli(
      "suggest",
      "--body",
      body,
      "--json",
      "--root",
      root,
      "--data-dir",
      dataDir,
    );
    const answer = JSON.parse(json.out) as {
      severity: { severity: string };
      suggestions: unknown[];
    };
    expect(answer.severity.severity).toBe("critical");
    expect(answer.suggestions).toHaveLength(NEIGHBOURS);
    expect(answer.suggestions[0]).toMatchObject({
      session: "synth",
      severity: "critical",
      body: "Missing the region in the cache key: two tariffs collide here.",
      similarity: expect.any(Number),
    });
  }, 120_000);

  it("gives from scratch the vectors the incremental updates gave, byte for byte", async () => {
    const model = await inThisProcess();
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
    const model = await inThisProcess();
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
    const model = await inThisProcess();
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

  it("suggests for a paraphrase a comment of its cluster first, and that cluster's severity", async () => {
    const model = await inThisProcess();
    // The synthetic review gives each severity two texts of its own (scripts/synth.ts).
    const cases = [
      {
        paraphrase:
          "The cache key does not include the region, so two tariffs overwrite each other.",
        body: "Missing the region in the cache key: two tariffs collide here.",
        severity: "critical",
      },
      {
        paraphrase: "A new default gets allocated on each request; move it out of the loop.",
        body: "This allocates on every request; hoist the default out of the loop.",
        severity: "warning",
      },
      {
        paraphrase: "Функция называется filter, а на деле делает map: переименуй или раздели.",
        body: "The name says filter, the body maps. Rename or split it.",
        severity: "nit",
      },
      {
        paraphrase: "Почему пустой список здесь ошибка, а в соседней ветке значение по умолчанию?",
        body: "Why is the empty list an error in this branch and a default in the next one?",
        severity: "question",
      },
    ];
    for (const one of cases) {
      const { suggestions, severity } = await suggest(dataDir, model, one.paraphrase);
      expect(suggestions, one.paraphrase).toHaveLength(NEIGHBOURS);
      // The similarity is in the message: the floor is 0.86, and a platform moves it by 0.0013.
      const said = `${one.paraphrase} (nearest at ${suggestions[0]?.similarity.toFixed(4)})`;
      expect(suggestions[0]?.body, said).toBe(one.body);
      expect(severity?.severity, said).toBe(one.severity);
    }
  }, 120_000);

  it("gives in a process of its own the bytes it gives on the calling thread", async () => {
    const model = await inThisProcess();
    const here = await model.embed(PROCESS_TEXTS);
    PROCESS_TEXTS.forEach((text, i) => {
      const there = fromProcess[i];
      if (there === undefined)
        throw new Error("run the whole file: its first test fills fromProcess");
      expect(
        Buffer.from(there.buffer).equals(Buffer.from((here[i] as Float32Array).buffer)),
        text,
      ).toBe(true);
    });
  }, 60_000);
});
