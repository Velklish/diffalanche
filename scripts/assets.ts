/** The model and the runtime's native files under their release names, checked against the pins:
 * staged for the release, `bun run scripts/assets.ts <dir>`, and handed to the binary build. */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { defaultCacheHome, modelDirectory } from "../src/core/ml/embed/cache.ts";
import type { Asset } from "../src/core/ml/embed/delivery.ts";
import { assets } from "../src/core/ml/embed/delivery.ts";
import { EMBEDDING_MODEL, EMBEDDING_PLATFORMS } from "../src/core/ml/embed/model.ts";

const PACKAGE = resolve("node_modules", "onnxruntime-node");

/** Where the file of an asset is on this machine, checked. */
function source({ asset, file }: Asset): string {
  const model = EMBEDDING_MODEL.files.includes(file);
  const path = model
    ? join(modelDirectory(defaultCacheHome(), EMBEDDING_MODEL), file.name)
    : join(PACKAGE, file.path);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(
      `${asset}: ${path} is not there${model ? "; run `bun run model:fetch`" : "; run `bun install`"}`,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== file.sha256) {
    throw new Error(`${asset}: ${path} has sha256 ${sha256}, the manifest pins ${file.sha256}`);
  }
  return path;
}

/** Asset name to file, for one target; nothing for a platform the runtime has no build for. */
export function embedded(platform: string): Record<string, string> {
  if (!EMBEDDING_PLATFORMS.includes(platform)) return {};
  return Object.fromEntries(
    assets(EMBEDDING_MODEL, platform).map((one) => [one.asset, source(one)]),
  );
}

/** Every asset of the release, once: the model's files and each platform's native files. */
function releaseAssets(): Asset[] {
  const all = EMBEDDING_PLATFORMS.flatMap((platform) => assets(EMBEDDING_MODEL, platform));
  return all.filter((one, index) => all.findIndex((other) => other.asset === one.asset) === index);
}

if (import.meta.main) {
  const dir = argv[2];
  if (dir === undefined) {
    stderr.write("usage: bun run scripts/assets.ts <dir>\n");
    exit(1);
  }
  try {
    mkdirSync(dir, { recursive: true });
    const list = releaseAssets();
    for (const one of list) copyFileSync(source(one), join(dir, one.asset));
    stdout.write(`${list.length}\n`);
  } catch (error) {
    stderr.write(`assets: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
  }
}
