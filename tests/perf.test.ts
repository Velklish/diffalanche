import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Budget, GateRow } from "../perf/budgets.ts";
import { BUDGETS, evaluate, fails, formatTable, RUNNER_ALLOWANCE } from "../perf/budgets.ts";
import { assertErasable, fixtureDrift } from "../perf/fixture.ts";
import type { Measurement } from "../perf/harness.ts";
import { parseArgs, SCRATCH_SESSION, twoSessions } from "../perf/harness.ts";
import {
  busier,
  describeLoad,
  IGNORE_LOAD,
  ignoringLoad,
  LOAD_CEILING,
  readLoad,
  tooBusy,
} from "../perf/load.ts";
import { generate, PROFILES, STAMP_FILE } from "../scripts/synth.ts";
import { loadConfig } from "../src/core/config/index.ts";

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
    expect(formatTable(rows, 1)).toContain("| 9.5 ms (20 on a runner) | 17.3 ms | ok |");
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
    // The allowance widens the ceiling; it does not remove it. The runner read
    // 17.3 on a good commit and its widened ceiling is 20: past that, red.
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

describe("the fixture the gate may erase", () => {
  let work: string;

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "da-perf-fixture-"));
  });

  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("refuses the repository, its ancestors and the home directory", () => {
    for (const path of [REPO_ROOT, dirname(REPO_ROOT), dirname(dirname(REPO_ROOT)), homedir()]) {
      expect(() => assertErasable(path)).toThrow(/the repository, an ancestor of it, or the home/);
    }
    // The flag the entry names as the worst case: `.` resolved from the root.
    expect(() => assertErasable(REPO_ROOT)).toThrow(/--fixture names a directory the gate owns/);
  });

  it("refuses a directory that is not empty and carries no synth.json, untouched", () => {
    const foreign = join(work, "foreign");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "not-ours.txt"), "keep me\n");
    expect(() => assertErasable(foreign)).toThrow(/is not empty and carries no synth\.json/);
    expect(readdirSync(foreign)).toEqual(["not-ours.txt"]);
  });

  it("refuses a review's own data directory, which is what the guard is for", () => {
    // `.diffalanche/` is what the tool writes into any folder somebody reviews.
    // Reading it as the mark of a fixture aimed the guard at its own subject.
    const review = join(work, "somebody-s-review");
    mkdirSync(join(review, ".diffalanche", "reviews", "task"), { recursive: true });
    writeFileSync(join(review, ".diffalanche", "current"), "task\n");
    expect(() => assertErasable(review)).toThrow(/is not empty and carries no synth\.json/);
    expect(readdirSync(review)).toEqual([".diffalanche"]);
  });

  it("allows a missing path, an empty directory, and a fixture this generator wrote", () => {
    expect(() => assertErasable(join(work, "not-there"))).not.toThrow();
    const empty = join(work, "empty");
    mkdirSync(empty);
    expect(() => assertErasable(empty)).not.toThrow();
    const ours = join(work, "ours");
    mkdirSync(join(ours, ".diffalanche"), { recursive: true });
    writeFileSync(join(ours, STAMP_FILE), "{}\n");
    writeFileSync(join(ours, "leftover.txt"), "from an earlier run\n");
    expect(() => assertErasable(ours)).not.toThrow();
  });

  it("refuses a path that exists and is not a directory", () => {
    const file = join(work, "a-file");
    writeFileSync(file, "not a directory\n");
    expect(() => assertErasable(file)).toThrow(/is not a directory/);
  });

  it("stops the gate itself before it deletes, not only the guard in isolation", async () => {
    const foreign = join(work, "gate-run");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "not-ours.txt"), "keep me\n");
    const run = await execFileAsync("bun", ["perf/gate.ts", "--fixture", foreign], {
      cwd: REPO_ROOT,
      timeout: 30_000,
      encoding: "utf8",
    }).catch((error: { code?: number; stderr?: string }) => error);
    expect((run as { code?: number }).code).toBe(1);
    // The frame, not the message: one run came back with a stack Bun had
    // rendered without the message, and the frame names which refusal fired.
    expect((run as { stderr?: string }).stderr ?? "").toMatch(/at assertErasable \(/);
    expect(readdirSync(foreign)).toEqual(["not-ours.txt"]);
  });
});

describe("a line the gate has no number for", () => {
  it("reports the line as not measured instead of comparing it", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const rows = evaluate([measurement({ cpuPerFrameMs: value })]);
      const cpu = rows.find((row) => row.budget.field === "cpuPerFrameMs");
      expect(cpu?.unmeasured).toBe(true);
      expect(cpu?.measured).toBeNull();
      expect(cpu?.failed).toBe(false);
      expect(formatTable(rows, 1)).toContain("| not measured | UNMEASURED |");
    }
  });

  it("does not trust an exact zero on a millisecond line, and does trust one on a count", () => {
    // `TaskDuration` going missing made this line 0.0 ms, and `0 > 8.3` is
    // false: the tightest line of the table printed `ok` for ever (DA-69).
    const zero = evaluate([measurement({ cpuPerFrameMs: 0 })]);
    expect(zero.find((row) => row.budget.field === "cpuPerFrameMs")?.unmeasured).toBe(true);
    // Zero long tasks is the goal of that line, not a gap in it.
    const none = evaluate([measurement({ scrollLongTasks: 0 })]);
    const tasks = none.find((row) => row.budget.field === "scrollLongTasks");
    expect(tasks?.unmeasured).toBe(false);
    expect(tasks?.measured).toBe(0);
    expect(tasks?.failed).toBe(false);
  });

  it("refuses a field the measurement does not carry at all", () => {
    const without = measurement();
    delete (without as Partial<Measurement>).composerOpenMs;
    const rows = evaluate([without]);
    expect(rows.find((row) => row.budget.field === "composerOpenMs")?.unmeasured).toBe(true);
  });

  it("is not rescued by the median: one bad sample out of three is enough", () => {
    const rows = evaluate([
      measurement(),
      measurement({ firstRenderMs: Number.NaN }),
      measurement(),
    ]);
    expect(rows.find((row) => row.budget.field === "firstRenderMs")?.unmeasured).toBe(true);
  });

  it("reports every measurable line as not measured when there are no runs at all", () => {
    const rows = evaluate([]);
    expect(rows.filter((row) => row.budget.field !== null).every((row) => row.unmeasured)).toBe(
      true,
    );
  });

  it("leaves a good table alone", () => {
    expect(evaluate([measurement(), measurement()]).some((row) => row.unmeasured)).toBe(false);
  });

  it("prints a pending line without a number as unmeasured, and does not fail the build", () => {
    // `pendingUntil` says this line does not stop the build, and that has to
    // hold whether the number is over the ceiling or missing altogether.
    const waiting: Budget[] = [
      {
        label: "waiting on a task",
        field: "updateMs",
        budget: 300,
        unit: "ms",
        pendingUntil: "DA-99",
      },
    ];
    const rows = evaluate([measurement({ updateMs: Number.NaN })], { budgets: waiting });
    expect(rows[0]?.unmeasured).toBe(true);
    expect(fails(rows[0] as GateRow)).toBe(false);
    expect(formatTable(rows, 1)).toContain("| not measured | UNMEASURED |");
  });

  it("stops the build for an unmeasured line that waits for nothing", () => {
    const rows = evaluate([measurement({ composerOpenMs: Number.NaN })]);
    const composer = rows.find((row) => row.budget.field === "composerOpenMs") as GateRow;
    expect(composer.unmeasured).toBe(true);
    expect(fails(composer)).toBe(true);
  });
});

describe("the provenance of the fixture the gate measures", () => {
  let fixture: string;
  let stamp: string;
  let current: string;
  let comments: string;

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), "da-perf-provenance-"));
    generate({ out: fixture, profile: PROFILES.small });
    stamp = join(fixture, STAMP_FILE);
    current = join(fixture, ".diffalanche", "current");
    comments = join(fixture, ".diffalanche", "reviews", "synth", "comments.json");
  });

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("accepts what the generator just wrote, and says what it wrote", () => {
    expect(fixtureDrift(fixture, PROFILES.small)).toBeNull();
    const wrote = JSON.parse(readFileSync(stamp, "utf8")) as {
      session: string;
      threads: number;
      replies: number;
    };
    expect(wrote.session).toBe("synth");
    expect(wrote.threads).toBe(PROFILES.small.comments);
    expect(wrote.replies).toBeGreaterThan(0);
  });

  it("refuses a fixture generated at another profile: the gate measures the full one", () => {
    expect(fixtureDrift(fixture)).toMatch(/was generated at 3 repositories/);
  });

  it("refuses a current that names the harness's scratch session", () => {
    const was = readFileSync(current, "utf8");
    writeFileSync(current, `${SCRATCH_SESSION}\n`);
    expect(fixtureDrift(fixture, PROFILES.small)).toMatch(
      new RegExp(`points current at ${SCRATCH_SESSION}, the generator wrote synth`),
    );
    writeFileSync(current, was);
    expect(fixtureDrift(fixture, PROFILES.small)).toBeNull();
  });

  it("refuses a session whose comment counts are not the ones the generator wrote", () => {
    const was = readFileSync(comments, "utf8");
    const held = JSON.parse(was) as { version: number; comments: unknown[] };
    writeFileSync(comments, JSON.stringify({ ...held, comments: held.comments.slice(0, 5) }));
    expect(fixtureDrift(fixture, PROFILES.small)).toMatch(/holds 5 threads and \d+ replies/);
    writeFileSync(comments, was);
    expect(fixtureDrift(fixture, PROFILES.small)).toBeNull();
  });

  it("refuses a fixture with no stamp, and one that is missing altogether", () => {
    const was = readFileSync(stamp, "utf8");
    rmSync(stamp);
    expect(fixtureDrift(fixture, PROFILES.small)).toMatch(
      /has no readable synth\.json \(missing\)/,
    );
    writeFileSync(stamp, "{ not json");
    expect(fixtureDrift(fixture, PROFILES.small)).toMatch(/has no readable synth\.json \(/);
    writeFileSync(stamp, was);
    expect(fixtureDrift(join(fixture, "not-there"), PROFILES.small)).toBe("is missing");
  });
});

describe("the harness's scratch session", () => {
  let fixture: string;

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), "da-perf-scratch-"));
    generate({ out: fixture, profile: PROFILES.small });
  });

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("has a name of its own that cannot compose with itself, and leaves current alone", async () => {
    const config = await loadConfig({ root: fixture });
    const first = await twoSessions(config);
    expect(first).toEqual({ current: "synth", other: SCRATCH_SESSION });
    expect(readFileSync(join(fixture, ".diffalanche", "current"), "utf8").trim()).toBe("synth");
    const again = await twoSessions(config);
    expect(again).toEqual(first);
    expect(readdirSync(join(fixture, ".diffalanche", "reviews")).sort()).toEqual([
      SCRATCH_SESSION,
      "synth",
    ]);
  });

  it("refuses to run on a fixture a killed run left pointing at the scratch session", async () => {
    const current = join(fixture, ".diffalanche", "current");
    const was = readFileSync(current, "utf8");
    writeFileSync(current, `${SCRATCH_SESSION}\n`);
    const config = await loadConfig({ root: fixture });
    await expect(twoSessions(config)).rejects.toThrow(/the harness's own scratch session/);
    writeFileSync(current, was);
  });
});

describe("the load the gate refuses to measure under", () => {
  it("reads the one-minute average per core", () => {
    const load = readLoad();
    expect(load.cores).toBeGreaterThan(0);
    expect(Number.isFinite(load.average)).toBe(true);
    expect(load.perCore).toBeCloseTo(load.average / load.cores, 1);
  });

  it("declines above the ceiling and answers below it", () => {
    const at = (perCore: number) => ({ average: perCore * 8, cores: 8, perCore });
    expect(tooBusy(at(LOAD_CEILING + 0.1))).toBe(true);
    expect(tooBusy(at(LOAD_CEILING))).toBe(false);
    expect(tooBusy(at(LOAD_CEILING / 10))).toBe(false);
    // The ceiling is an argument, so the rule is checked without the constant.
    expect(tooBusy(at(2), 1)).toBe(true);
    expect(tooBusy(at(2), 3)).toBe(false);
    // A reading that is not a number is not a quiet machine.
    expect(tooBusy({ average: Number.NaN, cores: 8, perCore: Number.NaN })).toBe(true);
  });

  it("takes the busier end: a machine that got busy halfway through decided the numbers", () => {
    const quiet = { average: 2, cores: 8, perCore: 0.25 };
    const loud = { average: 40, cores: 8, perCore: 5 };
    expect(busier(quiet, loud)).toBe(loud);
    expect(busier(loud, quiet)).toBe(loud);
  });

  it("takes the bypass only from the exact value, so a stray export cannot arm it", () => {
    expect(ignoringLoad({ [IGNORE_LOAD]: "1" })).toBe(true);
    expect(ignoringLoad({ [IGNORE_LOAD]: "0" })).toBe(false);
    expect(ignoringLoad({ [IGNORE_LOAD]: "true" })).toBe(false);
    expect(ignoringLoad({})).toBe(false);
  });

  it("says the load in words the table can carry", () => {
    expect(describeLoad({ average: 40, cores: 8, perCore: 5 })).toBe(
      `load average 40 over 8 cores is 5 per core, ceiling ${LOAD_CEILING}`,
    );
  });
});
