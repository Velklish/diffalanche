/** Command line around the harness: the chosen variants measured on the synthetic review, as JSON
 * on stdout; its options are in 11-perf.md, "The measurement harness". */
import { loadConfig } from "../src/core/config/index.ts";
import { startEmbedding } from "./embedding.ts";
import type { Measurement } from "./harness.ts";
import { lap, measure, parseArgs, printLaps, VARIANTS, withServer } from "./harness.ts";

async function main(): Promise<void> {
  lap("start");
  const options = parseArgs(process.argv.slice(2));
  const chosen =
    options.variants.length === 0
      ? VARIANTS
      : VARIANTS.filter((variant) => options.variants.includes(variant.name));
  if (chosen.length === 0) throw new Error(`unknown variant: ${options.variants.join(", ")}`);

  const results: Measurement[] = [];
  await withServer(options.fixture, async (baseUrl, sessions) => {
    const { dataDir } = await loadConfig({ root: options.fixture });
    const load = options.lag === null ? null : await startEmbedding(dataDir, options.lag.embedding);
    for (const variant of chosen) {
      for (let run = 0; run < options.runs; run += 1) {
        const measurement = await measure(baseUrl, variant, options.fixture, sessions);
        results.push(measurement);
        process.stderr.write(`${variant.name} run ${run + 1}: ${JSON.stringify(measurement)}\n`);
      }
    }
    if (load !== null) process.stderr.write(`event loop: ${JSON.stringify(await load.stop())}\n`);
  });
  printLaps();
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error: unknown) => {
  // The stack, not just the message: a gate that fails in the harness is read
  // from its output alone.
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
