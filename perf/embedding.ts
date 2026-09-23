/** `perf/run.ts --embedding`: `index rebuild` in a loop inside the server's process while the
 * page is measured, and how long the event loop was held (11-perf.md, DA-34.1). */
import { defaultCacheHome, modelDirectory } from "../src/core/ml/embed/cache.ts";
import { EMBEDDING_MODEL } from "../src/core/ml/embed/model.ts";
import { openEmbedder } from "../src/core/ml/embed/open.ts";
import type { ThreadedEmbedder } from "../src/core/ml/embed/threaded.ts";
import { startThreadedEmbedder } from "../src/core/ml/embed/threaded.ts";
import { updateIndex } from "../src/core/ml/index/index.ts";

type EmbeddingLoad = {
  passes: number;
  texts: number;
  /** One `embed` call each: the stretch the model held the thread for. */
  runMs: { median: number; p99: number; max: number };
  /** How late a 5 ms timer fired, over the whole measurement. */
  lagMs: { median: number; p99: number; max: number };
};

const TICK_MS = 5;

function summary(values: number[]): { median: number; p99: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (value: number) => Math.round(value * 10) / 10;
  return { median: round(at(0.5)), p99: round(at(0.99)), max: round(sorted.at(-1) ?? 0) };
}

/** `main` on the server's own thread, `worker` where the server runs it, `null` the loop alone;
 * the model is loaded before the timing starts, and `stop` waits for the pass under way. */
export async function startEmbedding(
  dataDir: string,
  where: "main" | "worker" | null,
): Promise<{ stop: () => Promise<EmbeddingLoad> }> {
  const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
  const loaded =
    where === "main"
      ? await openEmbedder(location)
      : where === "worker"
        ? await startThreadedEmbedder(location)
        : null;
  const runs: number[] = [];
  const embedder = loaded && {
    ...loaded,
    embed: async (texts: string[]) => {
      const started = performance.now();
      const vectors = await loaded.embed(texts);
      runs.push(performance.now() - started);
      return vectors;
    },
  };
  const lags: number[] = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - last - TICK_MS));
    last = now;
  }, TICK_MS);

  let stopping = false;
  let passes = 0;
  const loop = (async () => {
    while (embedder !== null && !stopping) {
      await updateIndex(dataDir, embedder, { rebuild: true });
      passes += 1;
    }
  })();

  return {
    stop: async () => {
      stopping = true;
      await loop;
      clearInterval(timer);
      if (where === "worker") await (loaded as ThreadedEmbedder).close();
      return { passes, texts: runs.length, runMs: summary(runs), lagMs: summary(lags) };
    },
  };
}
