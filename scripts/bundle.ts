/** The npm bundle: `dist/cli.js` and the model's process `dist/embed-child.js`, with the runtime
 * loading its binding from the user cache (09-ml.md, "Delivery"). Bun only, so `Bun.*` is allowed. */
import { readFile } from "node:fs/promises";

/** The part of Bun's bundler this uses; the repository carries no Bun types (scripts/README.md). */
type Load = (args: { path: string }) => Promise<{ contents: string; loader: "js" | "ts" }>;
type Plugin = {
  name: string;
  setup: (build: { onLoad: (options: { filter: RegExp }, load: Load) => void }) => void;
};
type Bundler = {
  build: (options: Record<string, unknown>) => Promise<{ success: boolean; logs: unknown[] }>;
};
export const bundler = (globalThis as unknown as { Bun: Bundler }).Bun;

/** What `onnxruntime-node/dist/binding.js` of 1.30.0 requires; a new version fails the build here. */
const ORT_REQUIRE =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text, not a template of ours
  "require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)";

/** Where `spawned.ts` finds the child's module from the sources. */
const CHILD_URL = 'new URL("./child-entry.ts", import.meta.url)';

/** The two edits a channel needs: the binding from the path `child.ts` sets, and the child from
 * `child`, the expression the channel's child file is reached by. */
export function channel(child: string): Plugin {
  const replace = async (path: string, from: string, to: string) => {
    const source = await readFile(path, "utf8");
    if (!source.includes(from)) throw new Error(`${path} no longer holds ${from}; see 09-ml.md`);
    return source.replace(from, to);
  };
  return {
    name: "diffalanche-channel",
    setup(build) {
      build.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, async (args) => ({
        contents: await replace(
          args.path,
          ORT_REQUIRE,
          "require(globalThis.__diffalancheOrtBinding)",
        ),
        loader: "js",
      }));
      build.onLoad({ filter: /src[\\/]core[\\/]ml[\\/]embed[\\/]spawned\.ts$/ }, async (args) => ({
        contents: await replace(args.path, CHILD_URL, child),
        loader: "ts",
      }));
    },
  };
}

async function build(entry: string, naming: string): Promise<void> {
  const result = await bundler.build({
    entrypoints: [entry],
    target: "node",
    outdir: "dist",
    naming,
    plugins: [channel('new URL("./embed-child.js", import.meta.url)')],
  });
  if (!result.success) throw new AggregateError(result.logs, `bundle: ${entry} did not build`);
}

export async function bundleNpm(): Promise<void> {
  await build("src/cli/index.ts", "cli.js");
  await build("src/core/ml/embed/child-entry.ts", "embed-child.js");
}

if (import.meta.main) await bundleNpm();
