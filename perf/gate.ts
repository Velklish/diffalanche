/**
 * The performance gate: measures the shipped page on the synthetic review
 * several times and fails when the median of any budget line is over budget.
 *
 *   bun perf/gate.ts [--fixture <dir>] [--runs <n>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { evaluate, formatTable, GATE_VARIANT } from "./budgets.ts";
import type { Measurement } from "./harness.ts";
import { measure, parseArgs, withServer } from "./harness.ts";

/**
 * The fixture and the built UI are what the harness needs; make them if they
 * are missing. A fixture left by an older generator counts as missing: one
 * without the `current` pointer has no review session, and the server would
 * refuse the review — which reads as a broken server rather than as a stale
 * directory. The check is the newest file the generator learned to write.
 */
function prepare(fixture: string): void {
  const current = join(fixture, ".diffalanche", "current");
  if (!existsSync(fixture) || !existsSync(current)) {
    rmSync(fixture, { recursive: true, force: true });
    execFileSync("bun", ["run", "synth", "--", "--out", fixture], { stdio: "inherit" });
  }
  execFileSync("bun", ["run", "build:ui"], { stdio: "inherit" });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), 3);
  const runs = options.runs;
  prepare(options.fixture);

  const measurements: Measurement[] = [];
  await withServer(options.fixture, async (baseUrl, sessions) => {
    for (let run = 0; run < runs; run += 1) {
      const measurement = await measure(baseUrl, GATE_VARIANT, options.fixture, sessions);
      measurements.push(measurement);
      process.stderr.write(`run ${run + 1}/${runs}: ${JSON.stringify(measurement)}\n`);
    }
  });

  const rows = evaluate(measurements);
  const table = formatTable(rows, runs);
  process.stdout.write(table);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `## Performance budgets\n\n${table}`);

  const failed = rows.filter((row) => row.failed);
  if (failed.length > 0) {
    process.stderr.write(`\nover budget: ${failed.map((row) => row.budget.label).join("; ")}\n`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  // The stack, not just the message: a gate that fails in the harness is read
  // from its output alone.
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
