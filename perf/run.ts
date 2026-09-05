/**
 * Command line around the harness: measures the chosen variants against the
 * synthetic review and prints the numbers as JSON on stdout.
 *
 *   bun perf/run.ts [--fixture <dir>] [--variant <name>]... [--runs <n>]
 */
import type { Measurement } from "./harness.ts";
import { measure, parseArgs, VARIANTS, withServer } from "./harness.ts";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const chosen =
    options.variants.length === 0
      ? VARIANTS
      : VARIANTS.filter((variant) => options.variants.includes(variant.name));
  if (chosen.length === 0) throw new Error(`unknown variant: ${options.variants.join(", ")}`);

  const results: Measurement[] = [];
  await withServer(options.fixture, async (baseUrl, sessions) => {
    for (const variant of chosen) {
      for (let run = 0; run < options.runs; run += 1) {
        const measurement = await measure(baseUrl, variant, options.fixture, sessions);
        results.push(measurement);
        process.stderr.write(`${variant.name} run ${run + 1}: ${JSON.stringify(measurement)}\n`);
      }
    }
  });
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
