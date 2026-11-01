import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), "diffalanche-repetition-test-"));
    mkdirSync(join(tree, "perf"));
  });

  afterEach(() => {
    rmSync(tree, { recursive: true, force: true });
  });

  it("reads one measurement from a successful repetition", () => {
    writeFileSync(join(tree, "perf/run.ts"), `console.log(${JSON.stringify(JSON.stringify([sample]))});`);
    expect(measureOnce("fixture", "default", tree)).toEqual(sample);
  });

  it("refuses output that is not exactly one measurement", () => {
    writeFileSync(join(tree, "perf/run.ts"), "console.log('[]');");
    expect(() => measureOnce("fixture", "default", tree)).toThrow(
      "perf/run.ts printed 0 measurements, one was expected",
    );
  });

  it.skipIf(process.platform === "win32")(
    "bounds a stalled repetition and removes its own child even while stdout is inherited",
    async () => {
      writeFileSync(join(tree, "perf/run.ts"), `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], {
  stdio: ["ignore", "inherit", "inherit"],
});
writeFileSync("ownership.json", JSON.stringify({ parent: process.pid, child: child.pid }));
setTimeout(() => console.log(${JSON.stringify(JSON.stringify([sample]))}), 1200);
`);
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
        await vi.waitFor(() => {
          expect(alive(owned.parent)).toBe(false);
          expect(alive(owned.child)).toBe(false);
        }, { timeout: 500, interval: 20 });
        process.stderr.write(`repetition cleanup: ${JSON.stringify(owned)} both absent\n`);
      } finally {
        // This fixture ends by itself on the old code too; cleanup touches only recorded children.
        for (const pid of [owned.child, owned.parent]) {
          if (alive(pid)) process.kill(pid, "SIGKILL");
        }
      }
    },
  );

});
