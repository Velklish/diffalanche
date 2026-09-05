import { describe, expect, it } from "vitest";
import type { Budget } from "../perf/budgets.ts";
import { BUDGETS, evaluate, formatTable, RUNNER_ALLOWANCE } from "../perf/budgets.ts";
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
    sessionSwitchMs: 40,
    loadLongTaskMs: 0,
    updateMs: 210,
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

  it("has nothing unmeasured left: every budget of the specification has a number", () => {
    expect(evaluate([measurement()]).filter((row) => row.measured === null)).toEqual([]);
  });

  it("prints a line nothing measures yet as pending, without failing it", () => {
    // DA-24 and DA-25 turned the last two on, so the rule is checked against a
    // table of its own rather than against a line of the real one.
    const nothing: Budget[] = [
      {
        label: "something no harness drives yet",
        field: null,
        budget: 100,
        unit: "ms",
        pendingUntil: "DA-99",
      },
    ];
    const rows = evaluate([measurement()], { budgets: nothing });
    expect(rows[0]?.measured).toBeNull();
    expect(rows[0]?.failed).toBe(false);
    expect(formatTable(rows, 1)).toContain("| pending | DA-99 |");
  });

  it("measures the session switch, and waits for DA-24.1 before failing on it", () => {
    const rows = evaluate([measurement({ sessionSwitchMs: 140 })]);
    const switching = rows.find((row) => row.budget.label === "Switching review sessions");
    expect(switching?.measured).toBe(140);
    // Measured over the whole wait since DA-25's review round, and over budget
    // on the cold path; where the built document is cached is DA-24.1's
    // question and the owner's call, so the number is printed with the task
    // named rather than failing the build.
    expect(switching?.failed).toBe(false);
    expect(formatTable(rows, 1)).toContain("| 140 ms | DA-24.1 |");
  });

  it("prints a line that is measured but still waiting for its task, and does not fail it", () => {
    // The real table has one such line — the session switch, waiting for
    // DA-24.1 — but the rule is checked against a table of its own so that it
    // stays covered when that one is turned on.
    const waiting: Budget[] = [
      {
        label: "something a later task finishes",
        field: "updateMs",
        budget: 300,
        unit: "ms",
        pendingUntil: "DA-99",
      },
    ];
    const rows = evaluate([measurement({ updateMs: 900 }), measurement({ updateMs: 900 })], {
      budgets: waiting,
    });
    expect(rows[0]?.measured).toBe(900);
    expect(rows[0]?.failed).toBe(false);
    expect(formatTable(rows, 2)).toContain("| 900 ms | DA-99 |");
  });

  it("gates the live update now that the harness measures it to the painted card", () => {
    const rows = evaluate([measurement({ updateMs: 900 }), measurement({ updateMs: 900 })]);
    const update = rows.find((row) => row.budget.field === "updateMs");
    expect(update?.measured).toBe(900);
    // DA-25 turned this line on: it measures the whole of what the person waits
    // for — the watcher, the stream, the fetch, the patch, and the paint.
    expect(update?.failed).toBe(true);
    expect(formatTable(rows, 2)).toContain("| 900 ms | FAIL |");
  });

  it("widens every ms ceiling by the runner allowance, and never the long-task one", () => {
    // What ubuntu-latest measured on the same commit the development machine
    // held (DA-5.1): a little over twice as slow, zero long tasks.
    const runner = measurement({ cpuPerFrameMs: 17.3, composerOpenMs: 50.5, firstRenderMs: 161 });
    expect(evaluate([runner]).some((row) => row.failed)).toBe(true);
    const rows = evaluate([runner], { allowance: RUNNER_ALLOWANCE });
    expect(rows.filter((row) => row.failed)).toEqual([]);
    expect(formatTable(rows, 1)).toContain("| 8.3 ms (20.8 on a runner) | 17.3 ms | ok |");
    // The long-task line is a count of zero on every machine.
    const tasks = evaluate([measurement({ scrollLongTasks: 1 })], { allowance: RUNNER_ALLOWANCE });
    expect(tasks.find((row) => row.budget.field === "scrollLongTasks")?.failed).toBe(true);
    // A zero budget times anything is zero, so that line cannot tell whether
    // the allowance stayed off `tasks`; a table with a count of one can.
    const counted: Budget[] = [
      { label: "long tasks", field: "scrollLongTasks", budget: 1, unit: "tasks" },
    ];
    const twoTasks = evaluate([measurement({ scrollLongTasks: 2 })], {
      budgets: counted,
      allowance: RUNNER_ALLOWANCE,
    });
    expect(twoTasks[0]?.ceiling).toBe(1);
    expect(twoTasks[0]?.failed).toBe(true);
    // Twice the runner's own reading is a regression the allowance does not hide.
    const slow = measurement({ cpuPerFrameMs: 21 });
    expect(evaluate([slow], { allowance: RUNNER_ALLOWANCE }).some((row) => row.failed)).toBe(true);
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
