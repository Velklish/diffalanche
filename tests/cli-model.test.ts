/** `model status` in process, against a cache home of the test's own: it names the model's
 * version and location, and says whether the files are there without reading them. */
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import { deliverFrom } from "../src/core/ml/embed/delivery.ts";
import {
  currentPlatform,
  EMBEDDING_MODEL,
  EMBEDDING_NATIVE,
  EMBEDDING_PLATFORMS,
} from "../src/core/ml/embed/model.ts";
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
      runtime: {
        name: "onnxruntime-node 1.30.0",
        platform: currentPlatform(),
        available: true,
        from: "node_modules",
      },
    });
  });

  it.skipIf(!EMBEDDING_PLATFORMS.includes(currentPlatform()))(
    "says whether the runtime's files are beside the model on the two channels",
    async () => {
      const native = EMBEDDING_NATIVE[currentPlatform()] ?? [];
      const runtime = join(location(), `onnxruntime-node-1.30.0-${currentPlatform()}`);
      deliverFrom({ from: "release", base: "http://127.0.0.1:9" });
      try {
        expect((await cli("model", "status")).out).toContain(
          `runtime    onnxruntime-node 1.30.0, ${currentPlatform()}: absent: ` +
            `${native.map((file) => file.name).join(", ")} missing or incomplete`,
        );
        mkdirSync(runtime, { recursive: true });
        for (const file of native) {
          writeFileSync(join(runtime, file.name), "");
          truncateSync(join(runtime, file.name), file.bytes);
        }
        const { out } = await cli("model", "status");
        expect(out).toMatch(
          new RegExp(
            `runtime    onnxruntime-node 1\\.30\\.0, ${currentPlatform()}: present, [0-9.]+ MB`,
          ),
        );
        const status = JSON.parse((await cli("model", "status", "--json")).out);
        expect(status.runtime).toMatchObject({ location: runtime, present: true, from: "cache" });
      } finally {
        deliverFrom({ from: "sources" });
      }
    },
  );

  it("says the runtime is not available on an Intel Mac", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const arch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    try {
      const { code, out } = await cli("model", "status");
      expect(code).toBe(0);
      expect(out).toContain(
        "runtime    onnxruntime-node 1.30.0, darwin-x64: not available on this platform",
      );
      expect(JSON.parse((await cli("model", "status", "--json")).out).runtime).toEqual({
        name: "onnxruntime-node 1.30.0",
        platform: "darwin-x64",
        available: false,
      });
    } finally {
      Object.defineProperty(process, "platform", platform as PropertyDescriptor);
      Object.defineProperty(process, "arch", arch as PropertyDescriptor);
    }
  });

  it("is a subcommand of a group that names it", async () => {
    const { code, err } = await cli("model");
    expect(code).toBe(1);
    expect(err).toBe("diffalanche: model needs a subcommand: status, pull\n");
  });
});
