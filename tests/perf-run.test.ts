import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => ({ calls: [] as { file: string; args: string[] }[] }));

// No browser and no server: every repetition's process is this stand-in, which records its argv.
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execFileSync: vi.fn((file: string, args: string[]) => {
      spawned.calls.push({ file, args });
      return JSON.stringify([{ variant: args[args.indexOf("--variant") + 1] }]);
    }),
  };
});

const { measureOnce } = await import("../perf/harness.ts");

/** Under this very file, so no user can make it: a run that went to its own server instead fails
 * with ENOTDIR on its first mkdir and writes nothing anywhere. */
const UNREACHABLE = join(fileURLToPath(import.meta.url), "fixture");

beforeEach(() => {
  spawned.calls.length = 0;
});

describe("one repetition's process", () => {
  it("is started for the gate and the comparison with the command line it always had", () => {
    measureOnce(".perf/fixture", "default", "/some/tree");
    expect(spawned.calls).toEqual([
      {
        file: "bun",
        args: ["perf/run.ts", "--fixture", ".perf/fixture", "--variant", "default", "--runs", "1"],
      },
    ]);
  });
});

describe("perf/run.ts above one repetition", () => {
  const argv = process.argv;
  let exit: ReturnType<typeof vi.spyOn>;
  let out: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = argv;
    exit.mockRestore();
    out.mockRestore();
    err.mockRestore();
  });

  async function run(...args: string[]): Promise<unknown[]> {
    process.argv = [argv[0] ?? "bun", "perf/run.ts", ...args];
    await import("../perf/run.ts");
    await vi.waitFor(() =>
      expect(out.mock.calls.length + exit.mock.calls.length).toBeGreaterThan(0),
    );
    const said = err.mock.calls.map((call: unknown[]) => String(call[0])).join("");
    expect(exit, `perf/run.ts exited; its stderr:\n${said}`).not.toHaveBeenCalled();
    return JSON.parse(String(out.mock.calls[0]?.[0])) as unknown[];
  }

  it("measures each repetition in a process of its own and prints every row", async () => {
    const rows = await run("--fixture", UNREACHABLE, "--runs", "3");
    expect(rows).toHaveLength(3);
    expect(spawned.calls.map((call) => call.args)).toEqual(
      Array.from({ length: 3 }, () => [
        "perf/run.ts",
        "--fixture",
        UNREACHABLE,
        "--variant",
        "default",
        "--runs",
        "1",
      ]),
    );
  });

  it("carries --lag to each repetition's process", async () => {
    await run("--fixture", UNREACHABLE, "--runs", "2", "--lag");
    expect(spawned.calls).toHaveLength(2);
    for (const call of spawned.calls) expect(call.args.slice(-1)).toEqual(["--lag"]);
  });
});
