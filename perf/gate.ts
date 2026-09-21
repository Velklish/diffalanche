/**
 * The performance gate: measures the shipped page on the synthetic review
 * several times and fails when the median of any budget line is over budget.
 *
 *   bun perf/gate.ts [--fixture <dir>] [--runs <n>]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, rmSync } from "node:fs";
import { fixtureEnv } from "../src/core/config/index.ts";
import { evaluate, formatTable, GATE_VARIANT, RUNNER_ALLOWANCE } from "./budgets.ts";
import { assertErasable, fixtureDrift } from "./fixture.ts";
import type { Measurement } from "./harness.ts";
import { parseArgs } from "./harness.ts";
import type { Load } from "./load.ts";
import { busier, describeLoad, IGNORE_LOAD, ignoringLoad, readLoad, tooBusy } from "./load.ts";

/** What every child is given: the fixture's own environment, passed and not
 * assigned — Bun hands a child the env the process started with (11-perf.md). */
const ENV = { ...process.env, ...fixtureEnv() };

/**
 * The fixture and the built UI are what the harness needs; make them when what
 * is on disk is not what the generator wrote. `fixtureDrift` says why, and the
 * reason is printed: a fixture the harness's scratch session left pointing at
 * itself measured a fifth of the specified comment load and said nothing about
 * it (DA-69).
 *
 * What may be erased at all is decided first, by `assertErasable`: the gate is
 * the process that deletes, so it is the process that asks (DA-63).
 */
function prepare(fixture: string): void {
  assertErasable(fixture);
  const drift = fixtureDrift(fixture);
  if (drift !== null) {
    process.stderr.write(`fixture ${fixture} ${drift}; regenerating\n`);
    rmSync(fixture, { recursive: true, force: true });
    execFileSync("bun", ["run", "synth", "--", "--out", fixture], { stdio: "inherit", env: ENV });
    // The generator and the check have to agree, or the gate would regenerate
    // on every run and nobody would read the line saying so.
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

/**
 * The three reds the gate can print, and it says which (ADR-013, DA-69). A line
 * over its ceiling, a line with no number the gate can trust, and a machine too
 * busy for any number off it to be about the code.
 */
function declineOnLoad(load: Load, when: string): never {
  process.stderr.write(
    `\nunable to measure: ${describeLoad(load)} ${when}. ` +
      `Run it on a quiet machine, or set ${IGNORE_LOAD}=1 to measure anyway ` +
      "and take the verdict as an indication rather than as evidence.\n",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2), 3);
  const runs = options.runs;
  const ignoring = ignoringLoad();

  // What may be erased is asked before anything else, so a mistyped `--fixture`
  // is never answered with "the machine is busy" (DA-63). `prepare` asks again:
  // the check belongs to whoever erases, not to whoever remembered to call it.
  assertErasable(options.fixture);

  // Then the load, before the fixture and the browser: a minute of measurement
  // that cannot produce a verdict is a minute spent on nothing.
  const started = readLoad();
  if (tooBusy(started) && !ignoring) declineOnLoad(started, "before the run");

  prepare(options.fixture);

  const measurements: Measurement[] = [];
  for (let run = 0; run < runs; run += 1) {
    const measurement = measureOnce(options.fixture);
    measurements.push(measurement);
    process.stderr.write(`run ${run + 1}/${runs}: ${JSON.stringify(measurement)}\n`);
  }

  // A GitHub-hosted runner gets the named allowance; a development machine the
  // specification's numbers (DA-5.1).
  const allowance = process.env.GITHUB_ACTIONS === "true" ? RUNNER_ALLOWANCE : 1;
  const rows = evaluate(measurements, { allowance });
  const table = formatTable(rows, runs);
  if (allowance !== 1) {
    process.stderr.write(`runner allowance ${allowance} on every ms line (perf/budgets.ts)\n`);
  }
  // The load of the busier end, because a machine that got busy halfway through
  // decided the numbers just as much as one that started busy.
  const load = busier(started, readLoad());
  const busy = tooBusy(load);
  if (busy) {
    process.stdout.write(
      `**Not evidence.** ${describeLoad(load)}: these numbers are about the machine.\n\n`,
    );
  }
  process.stdout.write(table);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `## Performance budgets\n\n${table}`);

  // Two different reds, and the gate says which: a line over its ceiling, and a
  // line the gate has no number for at all (DA-69).
  const unmeasured = rows.filter((row) => row.unmeasured);
  if (unmeasured.length > 0) {
    const labels = unmeasured.map((row) => row.budget.label).join("; ");
    process.stderr.write(`\nnot measured: ${labels}\n`);
  }
  const failed = rows.filter((row) => row.failed);
  if (failed.length > 0) {
    process.stderr.write(`\nover budget: ${failed.map((row) => row.budget.label).join("; ")}\n`);
  }
  if (busy && !ignoring) declineOnLoad(load, "during the run");
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
