/** `src/core/ml/embed`: the arithmetic around the model with no model at all, then the model
 * itself, read from the user cache where `bun run model:fetch` puts it (09-ml.md). */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultCacheHome, modelDirectory, modelStatus } from "../src/core/ml/embed/cache.ts";
import {
  type Embedder,
  embedder,
  loadEmbedder,
  meanPool,
  truncate,
} from "../src/core/ml/embed/embedder.ts";
import { EMBEDDING_MODEL } from "../src/core/ml/embed/model.ts";

const execFileAsync = promisify(execFile);
const RUNTIME = process.versions.bun === undefined ? "node" : "bun";

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.sqrt(na * nb);
}

describe("around the model", () => {
  it("cuts a long text to the window and keeps its closing token", () => {
    expect(truncate([0, 5, 6, 2], 8)).toEqual([0, 5, 6, 2]);
    expect(truncate([0, 5, 6, 7, 8, 2], 4)).toEqual([0, 5, 6, 2]);
  });

  it("averages a text's token states, then scales the mean to unit length", () => {
    // Three tokens of two dimensions: mean (2, 8/3), length 10/3, so (0.6, 0.8).
    const hidden = Float32Array.from([3, 0, 0, 4, 3, 4]);
    expect(Array.from(meanPool(hidden, 3, 2))).toEqual([
      expect.closeTo(0.6, 6),
      expect.closeTo(0.8, 6),
    ]);
  });

  it("keeps the model under the user cache, in a directory named after its revision", () => {
    expect(defaultCacheHome({ XDG_CACHE_HOME: "/x/cache" })).toBe("/x/cache");
    expect(defaultCacheHome({ XDG_CACHE_HOME: "" })).toMatch(/\.cache$/);
    expect(modelDirectory("/x/cache", EMBEDDING_MODEL)).toBe(
      join("/x/cache", "diffalanche", "models", "multilingual-e5-small-761b726dd34f"),
    );
  });

  it("calls the model present only when every file has the size the manifest names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-model-"));
    try {
      const empty = await modelStatus(dir, EMBEDDING_MODEL);
      expect(empty.present).toBe(false);
      expect(empty.files.map((file) => file.present)).toEqual([false, false, false]);

      // Sparse files of the right sizes: a status reads sizes, never the 118 MB of weights.
      for (const file of EMBEDDING_MODEL.files) {
        writeFileSync(join(dir, file.name), "");
        truncateSync(join(dir, file.name), file.bytes);
      }
      expect((await modelStatus(dir, EMBEDDING_MODEL)).present).toBe(true);

      truncateSync(join(dir, "tokenizer.json"), 1000);
      const short = await modelStatus(dir, EMBEDDING_MODEL);
      expect(short.present).toBe(false);
      expect(short.files.find((file) => file.name === "tokenizer.json")).toMatchObject({
        bytes: 1000,
        present: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a directory without the model by naming what is missing, and tries again next time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-model-"));
    try {
      await expect(loadEmbedder(dir)).rejects.toThrow(
        `the embedding model is not in ${dir}: model_quantized.onnx, tokenizer.json, tokenizer_config.json missing`,
      );
      const first = embedder(dir);
      await expect(first).rejects.toThrow(/not in/);
      expect(embedder(dir)).not.toBe(first);
      await expect(embedder(dir)).rejects.toThrow(/not in/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const TEXTS = [
  "This catch block swallows the error silently. Log it or rethrow.",
  "Ошибка тут просто глотается в catch, надо хотя бы залогировать.",
  "Unused import.",
  "Нет ограничения на размер загружаемого файла.",
];

describe(`the model on ${RUNTIME}`, () => {
  const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
  const realFetch = globalThis.fetch;
  let fetches = 0;
  let model: Embedder;

  beforeAll(async () => {
    const status = await modelStatus(location, EMBEDDING_MODEL);
    if (!status.present) {
      throw new Error(`the embedding model is not in ${location}: run \`bun run model:fetch\``);
    }
    // Every test below runs with `fetch` refused: a cached model must need none of it.
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("the network is off in this test");
    }) as typeof fetch;
    model = await embedder(location);
  }, 120_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("is loaded once per process", () => {
    expect(embedder(location)).toBe(embedder(location));
  });

  it("gives one unit vector of the model's dimensions per text, in the order given", async () => {
    const vectors = await model.embed(TEXTS);
    expect(vectors).toHaveLength(TEXTS.length);
    for (const vector of vectors) {
      expect(vector).toHaveLength(EMBEDDING_MODEL.dimensions);
      expect(cosine(vector, vector)).toBeCloseTo(1, 5);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 5);
    }
    const [english, russian, unused] = vectors;
    // The Russian comment says what the English one says; the third says something else.
    expect(cosine(english as Float32Array, russian as Float32Array)).toBeGreaterThan(
      cosine(english as Float32Array, unused as Float32Array),
    );
  }, 60_000);

  it("gives a text the same vector whatever it is embedded with", async () => {
    const together = await model.embed(TEXTS);
    const alone = await model.embed([TEXTS[2] as string]);
    expect(Array.from(alone[0] as Float32Array)).toEqual(Array.from(together[2] as Float32Array));
  }, 60_000);

  it("gives the vectors recorded for this model and its prefix", async () => {
    const recorded = JSON.parse(
      readFileSync(join(import.meta.dirname, "snapshots", "embedding-e5-small.json"), "utf8"),
    ) as { vectors: { text: string; vector: number[] }[] };
    const vectors = await model.embed(recorded.vectors.map((one) => one.text));
    recorded.vectors.forEach((one, index) => {
      // 0.99 lets another CPU's int8 kernels through (runtimes differ by 0.0042, ADR-014)
      // and stops a dropped `query: ` prefix, which moves these texts to 0.975–0.982.
      expect(cosine(vectors[index] as Float32Array, one.vector), one.text).toBeGreaterThan(0.99);
    });
  }, 60_000);

  it("gives the same vector on Node and on Bun", async (context) => {
    const other = RUNTIME === "node" ? "bun" : "node";
    const runsTypeScript = other === "bun" || (await nodeStripsTypes());
    if (!runsTypeScript) context.skip(`the ${other} on PATH cannot run TypeScript from source`);
    const here = await model.embed(TEXTS);
    const { stdout } = await execFileAsync(other, [join("tests", "helpers", "embed-texts.ts")], {
      env: { ...process.env, EMBED_TEXTS: JSON.stringify(TEXTS) },
      maxBuffer: 16 * 1024 * 1024,
    });
    const there = JSON.parse(stdout) as number[][];
    TEXTS.forEach((text, index) => {
      expect(
        cosine(here[index] as Float32Array, there[index] as number[]),
        `${RUNTIME} and ${other} on "${text}"`,
      ).toBeGreaterThan(0.999);
    });
  }, 180_000);

  it("never called fetch", () => {
    expect(fetches).toBe(0);
  });
});

/** Whether the `node` on PATH strips types, which it does from 22.18 on. */
async function nodeStripsTypes(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("node", ["-p", "process.versions.node"]);
    const [major = 0, minor = 0] = stdout.trim().split(".").map(Number);
    return major > 22 || (major === 22 && minor >= 18);
  } catch {
    return false;
  }
}
