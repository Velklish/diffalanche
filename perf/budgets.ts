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

export type GateRow = {
  budget: Budget;
  /** Median over the runs, or `null` for a line that is still pending. */
  measured: number | null;
  failed: boolean;
};

/**
 * A line fails when the median is over budget: one slow run does not fail a
 * build. `budgets` is the table above unless a caller brings its own, which is
 * how the rules here are tested without a pending line having to exist in it.
 */
export function evaluate(measurements: Measurement[], budgets: Budget[] = BUDGETS): GateRow[] {
  return budgets.map((budget) => {
    const field = budget.field;
    if (field === null) return { budget, measured: null, failed: false };
    const measured = median(measurements.map((one) => one[field]));
    // A line still waiting for the task that completes it is printed, not
    // failed: what it measures is a part of what the budget is about.
    const failed = budget.pendingUntil === undefined && measured > budget.budget;
    return { budget, measured, failed };
  });
}

export function formatTable(rows: GateRow[], runs: number): string {
  const lines = [
    `| Metric | Budget | Median of ${runs} | |`,
    "|---|---|---|---|",
    ...rows.map((row) => {
      const budget = `${row.budget.budget} ${row.budget.unit}`;
      if (row.measured === null) {
        return `| ${row.budget.label} | ${budget} | pending | ${row.budget.pendingUntil} |`;
      }
      const verdict = row.failed ? "FAIL" : (row.budget.pendingUntil ?? "ok");
      return `| ${row.budget.label} | ${budget} | ${row.measured} ${row.budget.unit} | ${verdict} |`;
    }),
  ];
  return `${lines.join("\n")}\n\n${CPU_PER_FRAME_NOTE}.\n`;
}
