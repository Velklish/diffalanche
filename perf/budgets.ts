import type { Measurement, VariantSpec } from "./harness.ts";
import { median } from "./harness.ts";

/**
 * The budget table of `docs/SPEC.md` section 6, in code. A line the harness
 * cannot measure yet is `pending`: it is printed, never failed, and the task
 * named in `pendingUntil` turns it on.
 */
/** The fields of a measurement a budget line can read: the numeric ones. */
type MetricField = {
  [K in keyof Measurement]: Measurement[K] extends number ? K : never;
}[keyof Measurement];

export type Budget = {
  /** The metric as the specification words it. */
  label: string;
  /** The field of a measurement this line reads, or `null` while nothing measures it. */
  field: MetricField | null;
  budget: number;
  unit: "ms" | "tasks";
  /**
   * The task that finishes this line. A line with no field is printed as
   * pending; a line that has one and is still waiting for that task is
   * measured and printed with the task named, and does not fail the build —
   * the number does not yet cover everything the budget is about.
   */
  pendingUntil?: string;
};

export const BUDGETS: Budget[] = [
  {
    label: "First render of the review after the server responds",
    field: "firstRenderMs",
    budget: 500,
    unit: "ms",
  },
  { label: "Scrolling the diff: long tasks", field: "scrollLongTasks", budget: 0, unit: "tasks" },
  { label: "Scrolling the diff: CPU per frame", field: "cpuPerFrameMs", budget: 9.5, unit: "ms" },
  { label: "Opening the comment form", field: "composerOpenMs", budget: 50, unit: "ms" },
  { label: "Jumping to a file from the navigation", field: "fileJumpMs", budget: 50, unit: "ms" },
  {
    label: "Switching review sessions",
    field: "sessionSwitchMs",
    budget: 100,
    unit: "ms",
  },
  { label: "Update after an edit in one repository", field: "updateMs", budget: 300, unit: "ms" },
];

/**
 * The page as it ships: no query string, so the gate measures the combination
 * ADR-008 chose rather than a variant kept for comparison.
 */
export const GATE_VARIANT: VariantSpec = { name: "default", query: "" };

/** The gate is set on what this machine reaches; 8.3 ms, the frame of 120 fps,
 * stays the goal of `docs/SPEC.md` section 6 (`docs/reference/11-perf.md`). */
const CPU_PER_FRAME_NOTE =
  "9.5 ms is what the gate enforces; 8.3 ms, the frame of 120 fps, is the goal of docs/SPEC.md section 6";

/** The allowance of a GitHub-hosted runner: derived from what a runner
 * measured, and it moves when a budget moves (`docs/reference/11-perf.md`). */
export const RUNNER_ALLOWANCE = 2.1;

export type GateRow = {
  budget: Budget;
  /** Median over the runs, or `null` for a pending line and for an unmeasured one. */
  measured: number | null;
  /** What the median was held against: the budget, times the allowance for `ms` lines. */
  ceiling: number;
  failed: boolean;
  /** No number the gate could compare: a third verdict beside `ok`, `FAIL` and
   * pending. `fails()` says whether it also stops the build. */
  unmeasured: boolean;
};

type EvaluateOptions = {
  /** The table to evaluate; the one above unless a test brings its own. */
  budgets?: Budget[];
  /** 1 on a development machine; `RUNNER_ALLOWANCE` on a GitHub-hosted runner. */
  allowance?: number;
};

/** A line fails when the MEDIAN is over its ceiling; `allowance` widens the
 * `ms` ceilings only, and an untrustworthy sample is unmeasured, not compared. */
export function evaluate(measurements: Measurement[], options: EvaluateOptions = {}): GateRow[] {
  const budgets = options.budgets ?? BUDGETS;
  const allowance = options.allowance ?? 1;
  return budgets.map((budget) => {
    const field = budget.field;
    const ceiling = budget.unit === "ms" ? round(budget.budget * allowance) : budget.budget;
    const row = { budget, measured: null, ceiling, failed: false, unmeasured: false };
    if (field === null) return row;
    const samples = measurements.map((one) => one[field]);
    if (samples.length === 0 || !samples.every((value) => trustworthy(value, budget.unit))) {
      return { ...row, unmeasured: true };
    }
    const measured = median(samples);
    // A line still waiting for the task that completes it is printed, not
    // failed: what it measures is a part of what the budget is about.
    const failed = budget.pendingUntil === undefined && measured > ceiling;
    return { ...row, measured, failed };
  });
}

/** A sample the gate may compare: absent, non-finite, or — on a millisecond
 * line only — an exact zero are not (`docs/reference/11-perf.md`). */
function trustworthy(value: number | undefined, unit: Budget["unit"]): boolean {
  if (value === undefined || !Number.isFinite(value)) return false;
  return unit !== "ms" || value !== 0;
}

/** Whether a row stops the build: a line waiting for its own task is printed
 * and not failed, over its ceiling or without a number alike. */
export function fails(row: GateRow): boolean {
  return row.budget.pendingUntil === undefined && (row.failed || row.unmeasured);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function formatTable(rows: GateRow[], runs: number): string {
  const lines = [
    `| Metric | Budget | Median of ${runs} | |`,
    "|---|---|---|---|",
    ...rows.map((row) => {
      const widened = row.ceiling !== row.budget.budget;
      const budget = widened
        ? `${row.budget.budget} ${row.budget.unit} (${row.ceiling} on a runner)`
        : `${row.budget.budget} ${row.budget.unit}`;
      if (row.unmeasured) {
        return `| ${row.budget.label} | ${budget} | not measured | UNMEASURED |`;
      }
      if (row.measured === null) {
        return `| ${row.budget.label} | ${budget} | pending | ${row.budget.pendingUntil} |`;
      }
      const verdict = row.failed ? "FAIL" : (row.budget.pendingUntil ?? "ok");
      return `| ${row.budget.label} | ${budget} | ${row.measured} ${row.budget.unit} | ${verdict} |`;
    }),
  ];
  return `${lines.join("\n")}\n\n${CPU_PER_FRAME_NOTE}.\n`;
}

/** How often identical trees may differ by more than a line resolves: once in a hundred. */
const RESOLVES = 0.99;
const SHUFFLES = 10_000;

/** Under eight a side, over one split in a hundred reaches the largest difference of medians
 * (1.30 % at six, 1.17 % at seven, 0.31 % at eight), so none could pass the threshold (11-perf.md). */
export const MINIMUM_RUNS = 8;

type Comparison = {
  label: string;
  unit: string;
  /** What the sides are held by: the median of a duration, the mean of a count. */
  statistic: "median" | "mean";
  base: number;
  branch: number;
  resolves: number;
  verdict: "worse" | "better" | "no difference" | "not measured";
};

/** A seeded generator, so the same samples always give the same answer. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The difference of `statistic` that a random split of these samples into two sides of the same
 * sizes exceeds once in a hundred: the smallest difference this run can tell from noise. */
export function resolution(base: number[], branch: number[], statistic = median): number {
  const pooled = [...base, ...branch];
  const random = seeded(110);
  const differences: number[] = [];
  for (let shuffle = 0; shuffle < SHUFFLES; shuffle += 1) {
    for (let i = pooled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pooled[i], pooled[j]] = [pooled[j] as number, pooled[i] as number];
    }
    const left = statistic(pooled.slice(0, base.length));
    differences.push(Math.abs(statistic(pooled.slice(base.length)) - left));
  }
  differences.sort((a, b) => a - b);
  return differences[Math.floor(RESOLVES * (differences.length - 1))] as number;
}

/** Every measured line of the budget table; higher is worse on all of them. A count is held by
 * its mean: a median of mostly zeros moves from 0 to 1 on any split, and resolves nothing. */
export function compare(base: Measurement[], branch: Measurement[]): Comparison[] {
  if (base.length < MINIMUM_RUNS || branch.length < MINIMUM_RUNS) {
    throw new Error(
      `a comparison takes at least ${MINIMUM_RUNS} runs a side, got ${base.length} and ${branch.length}`,
    );
  }
  return BUDGETS.flatMap(({ label, field, unit }): Comparison[] => {
    if (field === null) return [];
    const statistic = unit === "ms" ? median : mean;
    const name = unit === "ms" ? "median" : "mean";
    const left = base.map((one) => one[field]);
    const right = branch.map((one) => one[field]);
    // The gate's rule for a sample it cannot trust (DA-69): the line is not compared at all.
    if (![...left, ...right].every((value) => trustworthy(value, unit))) {
      const nothing = { base: Number.NaN, branch: Number.NaN, resolves: Number.NaN };
      return [{ label, unit, statistic: name, ...nothing, verdict: "not measured" }];
    }
    const resolves = resolution(left, right, statistic);
    const difference = statistic(right) - statistic(left);
    const verdict =
      Math.abs(difference) <= resolves ? "no difference" : difference > 0 ? "worse" : "better";
    const held = { base: statistic(left), branch: statistic(right) };
    return [{ label, unit, statistic: name, ...held, resolves, verdict }];
  });
}

export function formatComparison(rows: Comparison[], runs: number): string {
  const lines = [
    `| Metric | Base, ${runs} runs | Branch, ${runs} runs | Difference | Resolves | |`,
    "|---|---|---|---|---|---|",
    ...rows.map((row) => {
      if (row.verdict === "not measured") {
        return `| ${row.label} | not measured | not measured | | | not measured |`;
      }
      const difference = round(row.branch - row.base);
      const signed = difference > 0 ? `+${difference}` : `${difference}`;
      const held = `${row.unit}, ${row.statistic}`;
      return (
        `| ${row.label} | ${round(row.base)} ${held} | ${round(row.branch)} ${held} | ` +
        `${signed} ${row.unit} | ±${round(row.resolves)} ${row.unit} | ${row.verdict} |`
      );
    }),
  ];
  return `${lines.join("\n")}\n`;
}
