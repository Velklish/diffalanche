/**
 * The performance gate: measures the shipped page on the synthetic review
 * several times and fails when the median of any budget line is over budget.
 *
 *   bun perf/gate.ts [--fixture <dir>] [--runs <n>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { fixtureEnv } from "../src/core/config/index.ts";
import { evaluate, fails, formatTable, GATE_VARIANT, RUNNER_ALLOWANCE } from "./budgets.ts";
import { assertErasable, fixtureDrift } from "./fixture.ts";
import type { Measurement } from "./harness.ts";
import { parseArgs } from "./harness.ts";
import {
  beforeRun,
  busier,
  declineOnLoad,
  describeLoad,
  ignoringLoad,
  QUIET_WAIT_MS,
  readLoad,
  tooBusy,
} from "./load.ts";

/** What every child is given: the fixture's own environment, passed and not
 * assigned — Bun hands a child the env the process started with (11-perf.md). */
const ENV = { ...process.env, ...fixtureEnv() };

/** The fixture and the built UI, remade when what is on disk is not what the
 * generator wrote; `assertErasable` decides what may be erased at all. */
function prepare(fixture: string): void {
  assertErasable(fixture);
  const drift = fixtureDrift(fixture);
  if (drift !== null) {
    process.stderr.write(`fixture ${fixture} ${drift}; regenerating\n`);
    rmSync(fixture, { recursive: true, force: true });
    execFileSync("bun", ["run", "synth", "--", "--out", fixture], { stdio: "inherit", env: ENV });
    // The generator and the check must agree, or every run regenerates.
    const left = fixtureDrift(fixture);
    if (left !== null) throw new Error(`${fixture} ${left} after it was regenerated`);
  }
  execFileSync("bun", ["run", "build:ui"], { stdio: "inherit", env: ENV });
}

/**
 * One repetition is one process. The second browser a process launches after a
 * whole measurement stalls on this harness's runtime — the page never reports
 * ready, or a later step never returns, and Playwright's own timeouts do not
 * fire — while a process that measures once and exits completes every time
 * (DA-25.2). So the gate runs `perf/run.ts` once per repetition, each with its
 * own server and browser, and reads the number back from its stdout.
 */
function measureOnce(fixture: string): Measurement {
  const stdout = execFileSync(
    "bun",
    ["perf/run.ts", "--fixture", fixture, "--variant", GATE_VARIANT.name, "--runs", "1"],
    { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", env: ENV },
  );
  const results = JSON.parse(stdout) as Measurement[];
  const measurement = results[0];
  if (results.length !== 1 || measurement === undefined) {
    throw new Error(`perf/run.ts printed ${results.length} measurements, one was expected`);
  }
  return measurement;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), 3);
  const runs = options.runs;
  // On a GitHub-hosted runner the load is nobody's to control, and the runner
  // allowance is what stands in for it instead (ADR-013, DA-5.1).
  const onRunner = process.env.GITHUB_ACTIONS === "true";
  const ignoring = onRunner || ignoringLoad();

  // Before the load, so a mistyped `--fixture` is never answered with "the
  // machine is busy"; `prepare` asks again, because it is the one that erases.
  assertErasable(options.fixture);

  // Before the fixture and the browser: a minute that cannot produce a verdict
  // is a minute spent on nothing, and a machine still settling is waited for.
  const { load: started, measure } = await beforeRun();
  if (!measure) declineOnLoad(started, `before the run, after waiting ${QUIET_WAIT_MS / 1000} s`);

  prepare(options.fixture);

  const measurements: Measurement[] = [];
  for (let run = 0; run < runs; run += 1) {
    const measurement = measureOnce(options.fixture);
    measurements.push(measurement);
    process.stderr.write(`run ${run + 1}/${runs}: ${JSON.stringify(measurement)}\n`);
  }

  // A GitHub-hosted runner gets the named allowance; a development machine the
  // specification's numbers (DA-5.1).
  const allowance = onRunner ? RUNNER_ALLOWANCE : 1;
  const rows = evaluate(measurements, { allowance });
  const table = formatTable(rows, runs);
  if (allowance !== 1) {
    process.stderr.write(`runner allowance ${allowance} on every ms line (perf/budgets.ts)\n`);
  }
  // The busier end: a machine that got busy halfway through decided the
  // numbers as much as one that started busy.
  const load = busier(started, readLoad());
  const busy = !onRunner && tooBusy(load);
  // In the run summary too: a reader of that alone would otherwise take an
  // untrustworthy run for an ordinary verdict.
  const banner = busy
    ? `**Not evidence.** ${describeLoad(load)}: these numbers are about the machine.\n\n`
    : "";
  process.stdout.write(banner + table);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `## Performance budgets\n\n${banner}${table}`);

  // The machine first: a run that could not measure has no verdict to report.
  if (busy && !ignoring) declineOnLoad(load, "during the run");

  // The other two reds, and the gate says which of them it is.
  const unmeasured = rows.filter((row) => row.unmeasured && fails(row));
  if (unmeasured.length > 0) {
    const labels = unmeasured.map((row) => row.budget.label).join("; ");
    process.stderr.write(`\nnot measured: ${labels}\n`);
  }
  const failed = rows.filter((row) => row.failed && fails(row));
  if (failed.length > 0) {
    process.stderr.write(`\nover budget: ${failed.map((row) => row.budget.label).join("; ")}\n`);
  }
  if (unmeasured.length > 0 || failed.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  // The stack, not just the message: a gate that fails in the harness is read
  // from its output alone.
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
