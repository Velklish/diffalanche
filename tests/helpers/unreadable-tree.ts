/** A tree over a directory with one it may not read, in a process of its own so it can run without
 * root's capabilities (05-watcher.md, "What the unit tests hold"); prints what it saw as JSON. */
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { watchTree } from "../../src/core/watcher/tree.ts";

const [dir] = process.argv.slice(2);
if (!dir) throw new Error("usage: unreadable-tree <dir>");

const heard: string[] = [];
let fellBack = 0;
const tree = watchTree({
  dir,
  ignore: () => false,
  onChange: (path) => heard.push(path),
  onFallback: () => {
    fellBack += 1;
  },
});
await tree.ready;
const deadline = performance.now() + 10_000;
// Written again until one is heard: a watch is not delivering when it returns.
for (let attempt = 0; !heard.some((path) => path.startsWith("src/a-")); attempt += 1) {
  if (performance.now() > deadline) break;
  await writeFile(join(dir, "src", `a-${attempt}.ts`), `export const a = ${attempt};\n`);
  await new Promise((done) => setTimeout(done, 50));
}
// Past the first delivery, so a takeover that was coming has come.
await new Promise((done) => setTimeout(done, 300));
// What this process meets at the directory: the case holds only if it really may not read it.
let refused: string | null = null;
try {
  await readdir(join(dir, "volume"));
} catch (error) {
  refused = (error as NodeJS.ErrnoException).code ?? String(error);
}
process.stdout.write(`${JSON.stringify({ polling: tree.polling(), fellBack, heard, refused })}\n`);
tree.close();
