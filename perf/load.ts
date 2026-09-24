/** The load precondition of the gates the machine decides — `perf` and the UI suite: the
 * decision is ADR-013, what it reads, the wait and the bypass are in `docs/reference/11-perf.md`. */
import { cpus, loadavg } from "node:os";

/** Measuring anyway, deliberately, with the table saying the verdict is not evidence. */
export const IGNORE_LOAD = "DIFFALANCHE_PERF_IGNORE_LOAD";

/** Runnable work per core above which the gate declines: measured, and the
 * readings are in `docs/reference/11-perf.md`. */
export const LOAD_CEILING = 2.5;

/** How long a gate waits for a busy machine to settle before it declines, and how
 * often it looks; the kernel refreshes the averages every five seconds. */
export const QUIET_WAIT_MS = 300_000;
const QUIET_POLL_MS = 5_000;

export type Load = {
  /** The one- and five-minute load averages, as `uptime` prints the first two. */
  averages: [number, number];
  cores: number;
  /** Each average over the cores, in the same order. */
  perCore: [number, number];
};

export function readLoad(): Load {
  const [one = Number.NaN, five = Number.NaN] = loadavg();
  const cores = Math.max(1, cpus().length);
  return { averages: [one, five], cores, perCore: [round(one / cores), round(five / cores)] };
}

/** The busier of the two averages; a reading that is not a number is not a quiet machine. */
function worst(load: Load): number {
  return Math.max(...load.perCore.map((value) => (Number.isFinite(value) ? value : Infinity)));
}

/** Busy enough that a number off this machine is about the machine: over the
 * ceiling in the last minute, or in the last five, which the first has forgotten. */
export function tooBusy(load: Load, ceiling = LOAD_CEILING): boolean {
  return worst(load) > ceiling;
}

export function ignoringLoad(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[IGNORE_LOAD] === "1";
}

/** The busier of the two readings: load that rose during the run counts. */
export function busier(left: Load, right: Load): Load {
  return worst(right) > worst(left) ? right : left;
}

export function describeLoad(load: Load, ceiling = LOAD_CEILING): string {
  const [one, five] = load.averages.map(round);
  const [onePerCore, fivePerCore] = load.perCore;
  return `load averages ${one} and ${five} over one and five minutes on ${load.cores} cores are ${onePerCore} and ${fivePerCore} per core, ceiling ${ceiling}`;
}

type Wait = {
  read?: () => Load;
  sleep?: (ms: number) => Promise<void>;
  say?: (line: string) => void;
  waitMs?: number;
};

/** Reads the machine until it is quiet or the wait runs out, and hands back the last
 * reading: a busy one only when the wait ran out. */
export async function waitForQuiet(wait: Wait = {}): Promise<Load> {
  const read = wait.read ?? readLoad;
  const sleep = wait.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const say = wait.say ?? ((line: string) => process.stderr.write(`${line}\n`));
  const waitMs = wait.waitMs ?? QUIET_WAIT_MS;
  let load = read();
  if (!tooBusy(load)) return load;
  say(`waiting up to ${waitMs / 1000} s for a quiet machine: ${describeLoad(load)}`);
  for (let waited = QUIET_POLL_MS; waited <= waitMs; waited += QUIET_POLL_MS) {
    await sleep(QUIET_POLL_MS);
    load = read();
    if (!tooBusy(load)) {
      say(`quiet after ${waited / 1000} s: ${describeLoad(load)}`);
      return load;
    }
  }
  return load;
}

/** The precondition before a run: off on a hosted runner and under the bypass, where
 * the reading is only reported; otherwise a wait, and no measuring if it runs out. */
export async function beforeRun(
  env: NodeJS.ProcessEnv = process.env,
  wait: Wait = {},
): Promise<{ load: Load; measure: boolean }> {
  if (env.GITHUB_ACTIONS === "true" || ignoringLoad(env)) {
    return { load: (wait.read ?? readLoad)(), measure: true };
  }
  const load = await waitForQuiet(wait);
  return { load, measure: !tooBusy(load) };
}

/** The red both gates give a busy machine, in the same words (ADR-013). */
export function declineOnLoad(load: Load, when: string): never {
  process.stderr.write(
    `\nunable to measure: ${describeLoad(load)} ${when}. ` +
      `Run it on a quiet machine, or set ${IGNORE_LOAD}=1 to measure anyway ` +
      "and take the verdict as an indication rather than as evidence.\n",
  );
  process.exit(1);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
