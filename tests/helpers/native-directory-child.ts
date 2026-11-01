/** Runs one shared native scenario outside Vitest, on the same runtime as its parent. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supportsRecursiveWatch } from "../../src/core/watcher/tree.ts";
import { nativeDirectoryCases } from "./native-directory-cases.ts";

const [name, dir] = process.argv.slice(2);
const scenario = name === undefined ? undefined : nativeDirectoryCases[name];
if (scenario === undefined || dir === undefined)
  throw new Error("usage: native-directory-child <case> <dir>");
const probe = mkdtempSync(join(tmpdir(), "diffalanche-tree-capability-"));
try {
  await supportsRecursiveWatch(probe);
} finally {
  rmSync(probe, { recursive: true, force: true });
}
await scenario(dir);
process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
