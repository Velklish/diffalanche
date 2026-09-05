import { describe, expect, it } from "vitest";
import { BUDGETS, evaluate, formatTable } from "../perf/budgets.ts";
import type { Measurement } from "../perf/harness.ts";
import { parseArgs } from "../perf/harness.ts";

function measurement(over: Partial<Measurement> = {}): Measurement {
  return {
    variant: "default",
    firstRenderMs: 30,
    scrollLongTasks: 0,
    scrollLongTaskMs: 0,
    cpuPerFrameMs: 6,
    frames: 600,
    scrollDistancePx: 700_000,
    composerOpenMs: 14,
    fileJumpMs: 8,
    loadLongTaskMs: 0,
    ...over,
  };
}

describe("perf arguments", () => {
  it("takes the run count as given, one included", () => {
    expect(parseArgs(["--runs", "1"], 3).runs).toBe(1);
    expect(parseArgs(["--runs", "5"], 3).runs).toBe(5);
    expect(parseArgs([], 3).runs).toBe(3);
    expect(parseArgs([]).runs).toBe(1);
  });

  it("refuses a run count that is not a whole number of at least one", () => {
    for (const value of ["abc", "0", "-1", "1.5"]) {
      expect(() => parseArgs(["--runs", value])).toThrow(/--runs takes a whole number/);
    }
    expect(() => parseArgs(["--runs"])).toThrow(/--runs takes a whole number/);
  });
});

describe("perf gate", () => {
  it("passes when every measurable line is inside its budget", () => {
    const rows = evaluate([measurement(), measurement(), measurement()]);
    expect(rows.filter((row) => row.failed)).toEqual([]);
    expect(rows).toHaveLength(BUDGETS.length);
  });

  it("fails on the median, not on a single slow run", () => {
    const slow = measurement({ firstRenderMs: 900 });
    expect(evaluate([measurement(), slow, measurement()]).some((row) => row.failed)).toBe(false);
    expect(evaluate([slow, slow, measurement()]).some((row) => row.failed)).toBe(true);
  });

  it("prints a pending line without failing it", () => {
    const rows = evaluate([measurement()]);
    const pending = rows.filter((row) => row.measured === null);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((row) => !row.failed)).toBe(true);
    expect(formatTable(rows, 1)).toContain("| pending | DA-9 |");
  });

  it("marks the line that is over budget and only that one", () => {
    const rows = evaluate([
      measurement({ composerOpenMs: 61 }),
      measurement({ composerOpenMs: 61 }),
    ]);
    expect(rows.filter((row) => row.failed).map((row) => row.budget.label)).toEqual([
      "Opening the comment form",
    ]);
    expect(formatTable(rows, 2)).toContain("| 61 ms | FAIL |");
  });
});
