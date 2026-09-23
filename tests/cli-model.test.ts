/** `model status` in process, against a cache home of the test's own: it names the model's
 * version and location, and says whether the files are there without reading them. */
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import { EMBEDDING_MODEL } from "../src/core/ml/embed/model.ts";
import type { UiAssets } from "../src/server/assets.ts";

const noUi: UiAssets = { read: async () => null };
let cacheHome: string;

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
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

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), "diffalanche-cache-home-"));
  vi.stubEnv("XDG_CACHE_HOME", cacheHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cacheHome, { recursive: true, force: true });
});

const location = () =>
  join(cacheHome, "diffalanche", "models", "multilingual-e5-small-761b726dd34f");

describe("model status", () => {
  it("names the model, its revision and where it would be, and says it is absent", async () => {
    const { code, out } = await cli("model", "status");
    expect(code).toBe(0);
    expect(out).toContain("multilingual-e5-small int8 @ 761b726dd34f");
    expect(out).toContain(`location   ${location()}`);
    expect(out).toContain(
      "absent: model_quantized.onnx, tokenizer.json, tokenizer_config.json missing or incomplete",
    );
  });

  it("says present once every file has its size, and prints the same as JSON", async () => {
    mkdirSync(location(), { recursive: true });
    for (const file of EMBEDDING_MODEL.files) {
      writeFileSync(join(location(), file.name), "");
      truncateSync(join(location(), file.name), file.bytes);
    }
    expect((await cli("model", "status")).out).toContain("state      present, 135.4 MB");

    const { code, out } = await cli("model", "status", "--json");
    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      embedding: {
        name: "multilingual-e5-small",
        source: "Xenova/multilingual-e5-small",
        revision: EMBEDDING_MODEL.revision,
        quantization: "int8",
        location: location(),
        present: true,
        files: EMBEDDING_MODEL.files.map((file) => ({
          name: file.name,
          bytes: file.bytes,
          expected: file.bytes,
          present: true,
        })),
      },
    });
  });

  it("is a subcommand of a group that names it", async () => {
    const { code, err } = await cli("model");
    expect(code).toBe(1);
    expect(err).toBe("diffalanche: model needs a subcommand: status\n");
  });
});
