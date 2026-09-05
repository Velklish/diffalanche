import { describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import { VERSION } from "../src/cli/version.ts";
import type { UiAssets } from "../src/server/assets.ts";

const noUi: UiAssets = { read: async () => null };

async function invoke(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await run(argv, noUi, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

describe("cli", () => {
  it("prints the version of the package", async () => {
    const result = await invoke(["version"]);
    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out.trim()).toBe(VERSION);
  });

  it("prints the usage without arguments and for --help", async () => {
    for (const argv of [[], ["--help"], ["serve", "--help"]]) {
      const result = await invoke(argv);
      expect(result.code).toBe(0);
      expect(result.out).toContain("diffalanche serve");
    }
  });

  it("refuses an unknown command with exit code 1", async () => {
    const result = await invoke(["nope"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown command: nope");
    expect(result.out).toBe("");
  });
});
