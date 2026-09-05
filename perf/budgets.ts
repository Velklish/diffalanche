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
  { label: "Scrolling the diff: CPU per frame", field: "cpuPerFrameMs", budget: 8.3, unit: "ms" },
  { label: "Opening the comment form", field: "composerOpenMs", budget: 50, unit: "ms" },
  { label: "Jumping to a file from the navigation", field: "fileJumpMs", budget: 50, unit: "ms" },
  {
    label: "Switching review sessions",
    field: "sessionSwitchMs",
    budget: 100,
    unit: "ms",
    pendingUntil: "DA-24.1",
  },
  { label: "Update after an edit in one repository", field: "updateMs", budget: 300, unit: "ms" },
];

/**
 * The page as it ships: no query string, so the gate measures the combination
 * ADR-008 chose rather than a variant kept for comparison.
 */
export const GATE_VARIANT: VariantSpec = { name: "default", query: "" };

/** Frame rate is not measurable headless; the CPU ceiling is the frame of 120 fps. */
export const CPU_PER_FRAME_NOTE = "8.3 ms is the frame of 120 fps (docs/SPEC.md section 6)";

/**
 * The allowance of a GitHub-hosted runner. The budgets are the specification's
 * numbers and the development machine (Apple M1 Pro) meets them; `ubuntu-latest`
 * measured a little over twice as slow on every millisecond line of the same
 * commit — CPU per frame 17.3 ms against 7.8, the composer 50.5 against 22.6,
 * first render 161 against 87 (DA-5.1) — with zero long tasks. So on a runner
 * every `ms` ceiling is multiplied by this, the `tasks` line is not, and the
 * local run keeps the strict numbers: a budget that only CI enforces stops
 * being a budget developers meet. The ratio leaves about fifteen percent over
 * what the runner measured; a regression of that size on the development
 * machine is caught there first.
 */
export const RUNNER_ALLOWANCE = 2.5;

export type GateRow = {
  budget: Budget;
  /** Median over the runs, or `null` for a line that is still pending. */
  measured: number | null;
  /** What the median was held against: the budget, times the allowance for `ms` lines. */
  ceiling: number;
  failed: boolean;
};

export type EvaluateOptions = {
  /** The table to evaluate; the one above unless a test brings its own. */
  budgets?: Budget[];
  /** 1 on a development machine; `RUNNER_ALLOWANCE` on a GitHub-hosted runner. */
  allowance?: number;
};

/**
 * A line fails when the median is over its ceiling: one slow run does not fail
 * a build. `budgets` is the table above unless a caller brings its own, which
 * is how the rules here are tested without a pending line having to exist in
 * it; `allowance` widens the `ms` ceilings and never the `tasks` one.
 */
export function evaluate(measurements: Measurement[], options: EvaluateOptions = {}): GateRow[] {
  const budgets = options.budgets ?? BUDGETS;
  const allowance = options.allowance ?? 1;
  return budgets.map((budget) => {
    const field = budget.field;
    const ceiling = budget.unit === "ms" ? round(budget.budget * allowance) : budget.budget;
    if (field === null) return { budget, measured: null, ceiling, failed: false };
    const measured = median(measurements.map((one) => one[field]));
    // A line still waiting for the task that completes it is printed, not
    // failed: what it measures is a part of what the budget is about.
    const failed = budget.pendingUntil === undefined && measured > ceiling;
    return { budget, measured, ceiling, failed };
  });
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
      if (row.measured === null) {
        return `| ${row.budget.label} | ${budget} | pending | ${row.budget.pendingUntil} |`;
      }
      const verdict = row.failed ? "FAIL" : (row.budget.pendingUntil ?? "ok");
      return `| ${row.budget.label} | ${budget} | ${row.measured} ${row.budget.unit} | ${verdict} |`;
    }),
  ];
  return `${lines.join("\n")}\n\n${CPU_PER_FRAME_NOTE}.\n`;
}
