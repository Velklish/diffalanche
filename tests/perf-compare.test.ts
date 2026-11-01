import { afterEach, expect, it, vi } from "vitest";
import * as harness from "../perf/harness.ts";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));
vi.mock("../perf/fixture.ts", () => ({ fixtureDrift: () => null }));
vi.mock("../perf/load.ts", () => ({
  beforeRun: async () => ({ load: {}, measure: true }),
  describeLoad: () => "controlled load",
  readLoad: () => ({}),
}));
vi.mock("../perf/harness.ts", async (original) => ({
  ...(await original<typeof import("../perf/harness.ts")>()),
  measureOnce: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

it("fails an incomplete comparison with its repetition and preserves earlier raw samples", async () => {
  const originalArgv = process.argv;
  process.argv = ["bun", "perf/compare.ts", "--base", "/base"];
  const exit = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(harness.measureOnce)
    .mockReturnValueOnce({ variant: "default", firstRenderMs: 30 } as harness.Measurement)
    .mockImplementationOnce(() => {
      throw new Error("variant default timed out after 600000 ms");
    });

  try {
    await import("../perf/compare.ts");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  } finally {
    process.argv = originalArgv;
  }
  const lines = err.mock.calls.map(([line]) => String(line)).join("");
  expect(lines).toContain('base 1/9: {"variant":"default","firstRenderMs":30}; controlled load');
  expect(lines).toContain(
    "branch repetition 1/9 failed: variant default timed out after 600000 ms",
  );
  expect(lines).toContain("The comparison is incomplete; earlier samples remain on stderr.");
  expect(out).not.toHaveBeenCalled();
  expect(harness.measureOnce).toHaveBeenCalledTimes(2);
});
