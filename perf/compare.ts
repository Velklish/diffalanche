/** Is this tree worse than its base, line by line: 11-perf.md, "What the gate resolves, and comparing two trees". */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fixtureEnv } from "../src/core/config/index.ts";
import { compare, formatComparison, GATE_VARIANT, MINIMUM_RUNS } from "./budgets.ts";
import { fixtureDrift } from "./fixture.ts";
import type { Measurement } from "./harness.ts";
import { measureOnce, parseArgs } from "./harness.ts";
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--base");
  const named = at === -1 ? undefined : argv[at + 1];
  if (named === undefined) {
    throw new Error("--base <dir> names a checkout of the base, with its dependencies installed");
  }
  const options = parseArgs(argv, 9);
  // Before the lock's minutes are spent: under this, no line could come out as a difference.
  if (options.runs < MINIMUM_RUNS) {
    throw new Error(`--runs takes at least ${MINIMUM_RUNS} for a comparison, got ${options.runs}`);
  }
  const trees = { base: resolve(named), branch: process.cwd() };

  // Each tree's fixture is its own gate's to make and to erase; this only reads them.
  for (const [side, tree] of Object.entries(trees)) {
    const drift = fixtureDrift(resolve(tree, options.fixture));
    if (drift !== null) {
      throw new Error(`the ${side}'s fixture in ${tree} ${drift}; run \`bun run perf\` there once`);
    }
  }
  const { load: started, measure } = await beforeRun();
  if (!measure) declineOnLoad(started, `before the run, after waiting ${QUIET_WAIT_MS / 1000} s`);
  for (const tree of Object.values(trees)) {
    execFileSync("bun", ["run", "build:ui"], {
      cwd: tree,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, ...fixtureEnv() },
    });
  }

  // ABBA: the order turns every round, so a machine drifting one way loads both sides alike.
  const samples: Record<keyof typeof trees, Measurement[]> = { base: [], branch: [] };
  for (let round = 0; round < options.runs; round += 1) {
    const order = round % 2 === 0 ? (["base", "branch"] as const) : (["branch", "base"] as const);
    for (const side of order) {
      const measurement = measureOnce(options.fixture, GATE_VARIANT.name, trees[side]);
      samples[side].push(measurement);
      process.stderr.write(
        `${side} ${samples[side].length}/${options.runs}: ${JSON.stringify(measurement)}; ` +
          `${describeLoad(readLoad())}\n`,
      );
    }
  }

  const load = busier(started, readLoad());
  const busy = tooBusy(load);
  const banner = busy ? `**Not evidence.** ${describeLoad(load)}.\n\n` : "";
  const rows = compare(samples.base, samples.branch);
  process.stdout.write(banner + formatComparison(rows, options.runs));
  if (busy && !ignoringLoad()) declineOnLoad(load, "during the run");
  const unmeasured = rows.filter((row) => row.verdict === "not measured");
  if (unmeasured.length > 0) {
    process.stderr.write(`\nnot measured: ${unmeasured.map((row) => row.label).join("; ")}\n`);
  }
  const worse = rows.filter((row) => row.verdict === "worse");
  if (worse.length > 0) {
    process.stderr.write(`\nworse than the base: ${worse.map((row) => row.label).join("; ")}\n`);
  }
  if (unmeasured.length > 0 || worse.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
