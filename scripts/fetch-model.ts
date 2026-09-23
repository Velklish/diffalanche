#!/usr/bin/env bun
/** Puts the pinned embedding model into the user cache for the tests, locally and in CI.
 * Not the npm channel's download, which is DA-41's; see docs/reference/09-ml.md. */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit, stderr, stdout } from "node:process";
import { defaultCacheHome, modelDirectory, modelStatus } from "../src/core/ml/embed/cache.ts";
import { EMBEDDING_MODEL } from "../src/core/ml/embed/model.ts";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const model = EMBEDDING_MODEL;
const location = modelDirectory(defaultCacheHome(), model);
await mkdir(location, { recursive: true });
const status = await modelStatus(location, model);

for (const file of model.files) {
  const target = join(location, file.name);
  if (status.files.find((one) => one.name === file.name)?.present) {
    // The size matched; the checksum is what says it is the pinned file and not a truncated one.
    if (sha256(await readFile(target)) === file.sha256) {
      stdout.write(`  ${file.name}  already there\n`);
      continue;
    }
  }
  const url = `https://huggingface.co/${model.source}/resolve/${model.revision}/${file.path}`;
  const response = await fetch(url);
  if (!response.ok) {
    stderr.write(`model:fetch: ${url} answered ${response.status}\n`);
    exit(1);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = sha256(bytes);
  if (got !== file.sha256) {
    stderr.write(`model:fetch: ${file.name} has sha256 ${got}, the manifest pins ${file.sha256}\n`);
    exit(1);
  }
  // Written aside and renamed, so an interrupted fetch never leaves a file of the right name.
  await writeFile(`${target}.partial`, bytes);
  await rename(`${target}.partial`, target);
  stdout.write(`  ${file.name}  ${bytes.length} bytes, sha256 ok\n`);
}
stdout.write(`model:fetch: ${model.name} @ ${model.revision.slice(0, 12)} in ${location}\n`);
