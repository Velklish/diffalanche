import type { Measurement, VariantSpec } from "./harness.ts";
import { median } from "./harness.ts";

/**
 * The budget table of `docs/SPEC.md` section 6, in code. A line the harness
 * cannot measure yet is `pending`: it is printed, never failed, and the task
 * named in `pendingUntil` turns it on.
 */
/** The fields of a measurement a budget line can read: the numeric ones. */
export type MetricField = {
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
export const CPU_PER_FRAME_NOTE =
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

export type EvaluateOptions = {
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
