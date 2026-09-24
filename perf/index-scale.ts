/** The sizes behind 09-ml.md, "The index": search, read, catch-up and the memory of a query and of
 * the server as the index grows. Not a gate; 11-perf.md, "The sizes of the embedding index". */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment } from "../src/core/domain/index.ts";
import { defaultCacheHome, modelDirectory } from "../src/core/ml/embed/cache.ts";
import { type Embedder, embedder as embedderHere } from "../src/core/ml/embed/embedder.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "../src/core/ml/embed/model.ts";
import { openEmbedder, openServerEmbedder } from "../src/core/ml/embed/open.ts";
import type { SpawnedEmbedder } from "../src/core/ml/embed/spawned.ts";
import type { EmbeddingIndex, IndexEntry } from "../src/core/ml/index/index.ts";
import { indexPath, nearest, readIndex, updateIndex } from "../src/core/ml/index/index.ts";
import { writeIndex } from "../src/core/ml/index/store.ts";
import { dataDirOf, sessionDir } from "../src/core/storage/index.ts";
import { startReviewServer } from "../src/server/serve.ts";
import { createSuggestService } from "../src/server/suggest.ts";

const RUNTIME =
  process.versions.bun === undefined ? `node ${process.version}` : `bun ${process.versions.bun}`;

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function stats(values: number[]): { median: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    median: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    max: round(sorted.at(-1) ?? 0),
  };
}

function unit(dimensions: number): Float32Array {
  const vector = new Float32Array(dimensions);
  let norm = 0;
  for (let d = 0; d < dimensions; d += 1) {
    vector[d] = Math.random() - 0.5;
    norm += (vector[d] as number) ** 2;
  }
  return vector.map((value) => value / Math.sqrt(norm));
}

function fake(size: number): EmbeddingIndex {
  const dimensions = EMBEDDING_MODEL.dimensions;
  const body = "Null check is unreachable: the contract guarantees a non-null collection.";
  const entries: IndexEntry[] = [];
  const vectors = new Float32Array(size * dimensions);
  for (let row = 0; row < size; row += 1) {
    entries.push({
      session: `s${row % 50}`,
      id: `c_${row}`,
      severity: "warning",
      repo: "repos/g/a",
      path: "src/A.cs",
      line: row % 400,
      body,
    });
    vectors.set(unit(dimensions), row * dimensions);
  }
  return {
    identity: embeddingIdentity(),
    dimensions,
    updatedAt: "",
    sessions: {},
    entries,
    vectors,
  };
}

async function search(): Promise<void> {
  const dimensions = EMBEDDING_MODEL.dimensions;
  for (const size of [1_000, 10_000, 20_000, 50_000, 100_000]) {
    const index = fake(size);
    const dir = await mkdtemp(join(tmpdir(), "diffalanche-index-scale-"));
    try {
      await writeIndex(dir, index);
      const bytes = (await readFile(indexPath(dir))).length;
      const reads: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        const started = performance.now();
        await readIndex(dir);
        reads.push(performance.now() - started);
      }
      const all: number[] = [];
      const one: number[] = [];
      for (let run = 0; run < 25; run += 1) {
        const query = unit(dimensions);
        let started = performance.now();
        nearest(index, query, { k: 10 });
        if (run >= 5) all.push(performance.now() - started);
        started = performance.now();
        nearest(index, query, { k: 10, sessions: ["s7"] });
        if (run >= 5) one.push(performance.now() - started);
      }
      process.stdout.write(
        `${JSON.stringify({ runtime: RUNTIME, size, megabytes: Math.round(bytes / 1e5) / 10, readMs: stats(reads), searchMs: stats(all), oneSessionMs: stats(one) })}\n`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** `copies` sessions holding the comments of `from`, for an index of that many times its size. */
async function grow(dataDir: string, from: string, copies: number): Promise<void> {
  for (let copy = 1; copy <= copies; copy += 1) {
    const target = sessionDir(dataDir, `${from}-${copy}`);
    await cp(sessionDir(dataDir, from), target, { recursive: true });
    const review = JSON.parse(await readFile(join(target, "review.json"), "utf8"));
    await writeFile(
      join(target, "review.json"),
      JSON.stringify({ ...review, name: `${from}-${copy}` }, null, 2),
    );
  }
}

const LOCATION = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);

const mib = (bytes: number) => Math.round(bytes / 2 ** 20);

/** A `maxRSS` in bytes: Node reports kilobytes, and Bun passes getrusage's own unit on, which is
 * bytes on macOS. A child runs on the runtime of this process, so one rule reads both. */
function bytesOf(maxRSS: number): number {
  return process.versions.bun !== undefined && process.platform === "darwin"
    ? maxRSS
    : maxRSS * 1024;
}

const peakResident = () => bytesOf(process.resourceUsage().maxRSS);

/** The first update after N comments nobody indexed: N = 1 and N = every comment of the data dir. */
async function catchUp(dataDir: string, child: boolean): Promise<void> {
  const embedder: Embedder & { close?: () => Promise<void> } = child
    ? await openEmbedder(LOCATION)
    : await embedderHere(LOCATION);
  await embedder.embed(["warm-up"]);
  const lags: number[] = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - last - 5));
    last = now;
  }, 5);
  const measure = async (label: string, rebuild: boolean) => {
    lags.length = 0;
    const started = performance.now();
    const { update } = await updateIndex(dataDir, embedder, { rebuild });
    const ms = Math.round(performance.now() - started);
    process.stdout.write(
      `${JSON.stringify({ runtime: RUNTIME, where: child ? "child" : "main", label, embedded: update.embedded, kept: update.kept, ms, lagMs: stats(lags) })}\n`,
    );
  };
  await measure("every comment", true);
  const [session] = (await readIndex(dataDir)).index?.entries.map((entry) => entry.session) ?? [];
  if (session === undefined) throw new Error(`${dataDir}: no comments to index`);
  await addComment(dataDir, session, {
    severity: "nit",
    body: `one more comment ${Date.now()}`,
    author: "perf",
    role: "agent",
  });
  await measure("one new comment", false);
  await measure("nothing new", false);
  clearInterval(timer);
  await embedder.close?.();
}

/** One query the way a command asks it — the model in its process, the index read and searched in
 * this one — for the peak of each; `/usr/bin/time -l` reports the higher of the two. */
async function query(dataDir: string): Promise<void> {
  const embedder = await openEmbedder(LOCATION);
  let started = performance.now();
  const { index } = await readIndex(dataDir);
  if (index === null) throw new Error(`${dataDir}: no index; run \`index rebuild\` first`);
  const readMs = Math.round(performance.now() - started);
  started = performance.now();
  const [vector] = await embedder.embed([
    "Null check is unreachable: the collection is never null.",
  ]);
  const embedMs = Math.round(performance.now() - started);
  started = performance.now();
  const found = nearest(index, vector as Float32Array, { k: 10 });
  const searchMs = Math.round((performance.now() - started) * 10) / 10;
  const childPeakMiB = mib(bytesOf(await embedder.peak()));
  await embedder.close();
  process.stdout.write(
    `${JSON.stringify({ runtime: RUNTIME, entries: index.entries.length, readMs, embedMs, searchMs, first: found[0]?.body, peakMiB: mib(peakResident()), childPeakMiB })}\n`,
  );
}

/** The index of every comment of the data directory, random vectors in the model's place: what the
 * server holds after an update of thousands of comments, written in seconds rather than an hour. */
async function standIn(dataDir: string): Promise<void> {
  const random: Embedder = {
    model: EMBEDDING_MODEL,
    identity: embeddingIdentity(),
    embed: async (texts) => texts.map(() => unit(EMBEDDING_MODEL.dimensions)),
  };
  const { update } = await updateIndex(dataDir, random, { rebuild: true });
  process.stdout.write(`${JSON.stringify({ embedded: update.embedded })}\n`);
}

/** `serve` on a fixture, its index removed first unless `keep`: the review, the first suggestion —
 * the process, the model, the catch-up — then three warm ones; the server's peak and the model's. */
async function serveMemory(root: string, keep: boolean): Promise<void> {
  let peak = 0;
  const sample = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 20);
  // The fixture's own data directory, whatever the environment or the user config names.
  const config = { ...(await loadConfig({ root, dataDir: dataDirOf(root) })), port: 0 };
  if (!keep) await rm(join(config.dataDir, "index"), { recursive: true, force: true });
  const model: { opened?: Promise<SpawnedEmbedder> } = {};
  const suggest = createSuggestService(config.dataDir, () => {
    model.opened = openServerEmbedder(LOCATION);
    return model.opened;
  });
  const server = await startReviewServer({ config, suggest });
  const ask = async (path: string) => {
    const started = performance.now();
    const response = await fetch(`${server.url}${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    await response.json();
    return Math.round(performance.now() - started);
  };
  try {
    await ask("/api/review");
    const firstMs = await ask("/api/suggest?body=the%20cache%20key%20misses%20the%20region");
    const warmMs = [];
    for (let i = 0; i < 3; i += 1) warmMs.push(await ask(`/api/suggest?body=warm%20${i}`));
    const { index } = await readIndex(config.dataDir);
    if (model.opened === undefined) throw new Error("the first suggestion started no process");
    const childPeakMiB = mib(bytesOf(await (await model.opened).peak()));
    process.stdout.write(
      `${JSON.stringify({ runtime: RUNTIME, comments: index?.entries.length, firstMs, warmMs, peakMiB: mib(peakResident()), sampledPeakMiB: mib(peak), childPeakMiB })}\n`,
    );
  } finally {
    clearInterval(sample);
    await server.close();
  }
}

const mode = process.argv[2];
const dataDir = option("data-dir");
if (mode === "search") await search();
else if (mode === "grow" && dataDir)
  await grow(dataDir, option("from") ?? "synth", Number(option("copies") ?? "49"));
else if (mode === "catch-up" && dataDir) await catchUp(dataDir, process.argv.includes("--child"));
else if (mode === "query" && dataDir) await query(dataDir);
else if (mode === "fake" && dataDir) await writeIndex(dataDir, fake(Number(option("size"))));
else if (mode === "stand-in" && dataDir) await standIn(dataDir);
else if (mode === "serve" && option("root"))
  await serveMemory(option("root") as string, process.argv.includes("--keep-index"));
else {
  process.stderr.write('usage: docs/reference/11-perf.md, "The sizes of the embedding index"\n');
  process.exit(1);
}
