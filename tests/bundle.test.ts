/** `scripts/bundle.ts`: the two edits a channel makes to what it bundles, and the refusal when a
 * new version of either file no longer holds the text the edit expects (09-ml.md, "Delivery"). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { channel } from "../scripts/bundle.ts";

type Load = (args: { path: string }) => Promise<{ contents: string; loader: string }>;

/** The plugin's two loaders, by the filter they were registered with. */
function loaders(): { filter: RegExp; load: Load }[] {
  const found: { filter: RegExp; load: Load }[] = [];
  channel('new URL("./embed-worker.js", import.meta.url)').setup({
    onLoad: (options, load) => found.push({ filter: options.filter, load }),
  });
  return found;
}

describe("the channel's edits", () => {
  const binding = join("node_modules", "onnxruntime-node", "dist", "binding.js");
  const threaded = join("src", "core", "ml", "embed", "threaded.ts");

  it("loads the runtime's binding from the path the delivery sets", async () => {
    const loader = loaders().find((one) => one.filter.test(binding));
    const { contents } = await (loader as { load: Load }).load({ path: binding });
    expect(contents).toContain("require(globalThis.__diffalancheOrtBinding)");
    expect(contents).not.toContain("../bin/napi-v6/");
  });

  it("starts the thread from the channel's worker file", async () => {
    const loader = loaders().find((one) => one.filter.test(threaded));
    const { contents } = await (loader as { load: Load }).load({ path: threaded });
    expect(contents).toContain('new URL("./embed-worker.js", import.meta.url)');
    expect(contents).not.toContain('new URL("./worker.ts", import.meta.url)');
  });

  it("refuses to build a file that no longer holds what it edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-bundle-"));
    try {
      const moved = join(dir, "onnxruntime-node", "dist");
      mkdirSync(moved, { recursive: true });
      writeFileSync(join(moved, "binding.js"), "exports.binding = require('./elsewhere.node');\n");
      const loader = loaders().find((one) => one.filter.test(join(moved, "binding.js")));
      await expect(
        (loader as { load: Load }).load({ path: join(moved, "binding.js") }),
      ).rejects.toThrow(/no longer holds require\(`\.\.\/bin\/napi-v6\//);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
