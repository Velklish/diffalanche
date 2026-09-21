/**
 * The load precondition of the gate (ADR-013). `bun run perf` holds a
 * development machine to the specification's numbers, and on a busy machine
 * those numbers are decided by the machine rather than by the code — so the
 * gate declines to produce a verdict instead of producing a wrong one.
 *
 * The threshold, the evidence behind it, and the bypass are in
 * `docs/reference/11-perf.md`.
 */
import { cpus, loadavg } from "node:os";

/** Measuring anyway, deliberately, with the table saying the verdict is not evidence. */
export const IGNORE_LOAD = "DIFFALANCHE_PERF_IGNORE_LOAD";

/**
 * Runnable work per core above which the gate declines. Measured, not chosen —
 * the fifteen readings it comes from are in `docs/reference/11-perf.md`.
 */
export const LOAD_CEILING = 2.5;

export type Load = {
  /** The one-minute load average, as `uptime` prints it first. */
  average: number;
  cores: number;
  perCore: number;
};

export function readLoad(): Load {
  const average = loadavg()[0] ?? Number.NaN;
  const cores = Math.max(1, cpus().length);
  return { average, cores, perCore: round(average / cores) };
}

/** Busy enough that a number off this machine is about the machine. */
export function tooBusy(load: Load, ceiling = LOAD_CEILING): boolean {
  return !Number.isFinite(load.perCore) || load.perCore > ceiling;
}

export function ignoringLoad(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[IGNORE_LOAD] === "1";
}

/** The busier of the two readings: load that rose during the run counts. */
export function busier(left: Load, right: Load): Load {
  return right.perCore > left.perCore ? right : left;
}

export function describeLoad(load: Load, ceiling = LOAD_CEILING): string {
  return `load average ${load.average} over ${load.cores} cores is ${load.perCore} per core, ceiling ${ceiling}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
