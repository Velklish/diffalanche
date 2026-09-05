/**
 * The performance gate: measures the shipped page on the synthetic review
 * several times and fails when the median of any budget line is over budget.
 *
 *   bun perf/gate.ts [--fixture <dir>] [--runs <n>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { evaluate, formatTable, GATE_VARIANT } from "./budgets.ts";
import type { Measurement } from "./harness.ts";
import { measure, parseArgs, withServer } from "./harness.ts";

/** The fixture and the built UI are what the harness needs; make them if they are missing. */
function prepare(fixture: string): void {
  if (!existsSync(fixture)) {
    execFileSync("bun", ["run", "synth", "--", "--out", fixture], { stdio: "inherit" });
  }
  execFileSync("bun", ["run", "build:ui"], { stdio: "inherit" });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), 3);
  const runs = options.runs;
  prepare(options.fixture);

  const measurements: Measurement[] = [];
  await withServer(options.fixture, async (baseUrl) => {
    for (let run = 0; run < runs; run += 1) {
      const measurement = await measure(baseUrl, GATE_VARIANT);
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
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
