/** The native removal scenario in its own runtime; the parent asserts the captured outcome
 * (05-watcher.md, "What the unit tests hold"). */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { perDirectory, supportsRecursiveWatch, watchTree } from "../../src/core/watcher/tree.ts";

const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: removed-directory <dir>");
const probe = mkdtempSync(join(tmpdir(), "diffalanche-tree-capability-"));
try {
  await supportsRecursiveWatch(probe);
} finally {
  rmSync(probe, { recursive: true, force: true });
}

const heard: string[] = [];
let fellBack = 0;
const tree = watchTree({
  dir,
  ignore: () => false,
  native: perDirectory,
  onChange: (path) => heard.push(path),
  onFallback: () => {
    fellBack += 1;
  },
});
const wait = async (from: number, path: string) => {
  const deadline = performance.now() + 20_000;
  while (!heard.slice(from).includes(path)) {
    if (performance.now() > deadline) throw new Error(`${path} was not heard`);
    await new Promise((done) => setTimeout(done, 5));
  }
};
let failure: string | null = null;
let removed: string[] = [];
let retained: string[] = [];
try {
  await tree.ready;
  const deadline = performance.now() + 20_000;
  for (let attempt = 0; !heard.some((path) => path.startsWith("armed-")); attempt += 1) {
    if (performance.now() > deadline) throw new Error("the watch never armed");
    writeFileSync(join(dir, `armed-${attempt}`), "");
    await new Promise((done) => setTimeout(done, 50));
  }
  const from = heard.length;
  rmSync(join(dir, "gone"), { recursive: true });
  await wait(from, "gone");
  removed = heard.slice(from);
  const after = heard.length;
  writeFileSync(join(dir, "kept/after.ts"), `kept/after.ts ${Date.now()}\n`);
  await wait(after, "kept/after.ts");
  retained = heard.slice(after);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  const outcome = { failure, removed, retained, heard, polling: tree.polling(), fellBack };
  tree.close();
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
