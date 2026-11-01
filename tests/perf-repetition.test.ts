import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureOnce } from "../perf/harness.ts";

const sample = { variant: "default", firstRenderMs: 30 };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("one performance repetition", () => {
  let tree: string;
  let outputs: string[];
  const outputFiles = () =>
    readdirSync(tmpdir())
      .filter((name) => name.startsWith("diffalanche-perf-output-"))
      .sort();

  beforeEach(() => {
    outputs = outputFiles();
    tree = mkdtempSync(join(tmpdir(), "diffalanche-repetition-test-"));
    mkdirSync(join(tree, "perf"));
  });

  afterEach(() => {
    rmSync(tree, { recursive: true, force: true });
    expect(outputFiles()).toEqual(outputs);
  });

  it("reads one measurement from a successful repetition", () => {
    writeFileSync(
      join(tree, "perf/run.ts"),
      `console.log(${JSON.stringify(JSON.stringify([sample]))});`,
    );
    expect(measureOnce("fixture", "default", tree)).toEqual(sample);
  });

  it("refuses output that is not exactly one measurement", () => {
    writeFileSync(join(tree, "perf/run.ts"), "console.log('[]');");
    expect(() => measureOnce("fixture", "default", tree)).toThrow(
      "perf/run.ts printed 0 measurements, one was expected",
    );
  });

  it.skipIf(process.platform === "win32")(
    "bounds a stalled repetition while a finite child retains stdout",
    async () => {
      writeFileSync(
        join(tree, "perf/run.ts"),
        `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync('child-finished', 'done'), 1500)"], {
  stdio: ["ignore", "inherit", "inherit"],
});
writeFileSync("ownership.json", JSON.stringify({ parent: process.pid, child: child.pid }));
setTimeout(() => console.log(${JSON.stringify(JSON.stringify([sample]))}), 1200);
`,
      );
      let failure: unknown;
      try {
        measureOnce("fixture", "default", tree, null, 300);
      } catch (error) {
        failure = error;
      }
      const owned = JSON.parse(readFileSync(join(tree, "ownership.json"), "utf8")) as {
        parent: number;
        child: number;
      };
      process.stderr.write(`repetition ownership: ${JSON.stringify(owned)}\n`);
      try {
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain("variant default");
        expect((failure as Error).message).toContain("timed out after 300 ms");
        expect((failure as Error).message).toContain(tree);
        const cause = (failure as Error).cause as { pid: number; code: string; signal: string };
        expect(cause.pid).toBe(owned.parent);
        expect(cause.code).toBe("ETIMEDOUT");
        process.stderr.write(
          `repetition timeout: ${JSON.stringify({ pid: cause.pid, code: cause.code, signal: cause.signal })}\n`,
        );
        expect(alive(owned.parent)).toBe(false);
        expect(alive(owned.child)).toBe(true);
        expect(existsSync(join(tree, "child-finished"))).toBe(false);
        process.stderr.write(
          `deadline returned before finite child ended: ${JSON.stringify(owned)}\n`,
        );
      } finally {
        // Only this fixture's finite child is awaited; the deadline never waits on its stdout.
        await vi.waitFor(
          () => {
            expect(existsSync(join(tree, "child-finished"))).toBe(true);
            expect(alive(owned.child)).toBe(false);
          },
          { timeout: 3000, interval: 20 },
        );
        process.stderr.write(`repetition cleanup: ${JSON.stringify(owned)} both absent\n`);
      }
    },
  );
});
