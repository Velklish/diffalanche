/** `bun run check:comments`: every comment block over two lines, the rule of ADR-011
 * ([11-perf.md](../docs/reference/11-perf.md#the-comment-gate)). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

export const ROOTS = ["src", "tests", "e2e", "perf", "scripts", ".github"];
const SLASH = new Set([".ts", ".tsx", ".css"]);
const HASH = new Set([".yml", ".yaml", ".sh"]);
const LIMIT = 2;

type Block = { file: string; line: number; lines: number };

/** The blocks of one file's text, longer than the limit or not. */
export function blocks(text: string, kind: "slash" | "hash"): { line: number; lines: number }[] {
  const found: { line: number; lines: number }[] = [];
  const rows = text.split("\n");
  let run: { line: number; lines: number } | null = null;
  const close = () => {
    if (run !== null) found.push(run);
    run = null;
  };
  for (let index = 0; index < rows.length; index += 1) {
    const row = (rows[index] as string).trim();
    if (kind === "hash") {
      if (row.startsWith("#") && !(index === 0 && row.startsWith("#!"))) {
        run ??= { line: index + 1, lines: 0 };
        run.lines += 1;
      } else close();
      continue;
    }
    if (row.startsWith("/*") || row.startsWith("{/*")) {
      close();
      const start = index;
      while (index < rows.length && !(rows[index] as string).includes("*/")) index += 1;
      found.push({ line: start + 1, lines: Math.min(index, rows.length - 1) - start + 1 });
      continue;
    }
    if (row.startsWith("//")) {
      run ??= { line: index + 1, lines: 0 };
      run.lines += 1;
    } else close();
  }
  close();
  return found;
}

function files(path: string): string[] {
  if (!statSync(path, { throwIfNoEntry: false })) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules")
    .flatMap((entry) => files(join(path, entry.name)));
}

/** Every block over the limit under the given paths, in file order. */
export function overLimit(paths: string[], root: string): Block[] {
  const over: Block[] = [];
  for (const file of paths.flatMap((path) => files(resolve(root, path))).sort()) {
    const extension = extname(file);
    const kind = SLASH.has(extension) ? "slash" : HASH.has(extension) ? "hash" : null;
    if (kind === null) continue;
    for (const block of blocks(readFileSync(file, "utf8"), kind)) {
      if (block.lines > LIMIT) over.push({ file: relative(root, file), ...block });
    }
  }
  return over;
}

if (argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), "../..");
  const paths = argv.slice(2);
  const missing = paths.filter((path) => !statSync(resolve(root, path), { throwIfNoEntry: false }));
  if (missing.length > 0) {
    stderr.write(`no such path under ${root}: ${missing.join(", ")}\n`);
    exit(2);
  }
  const over = overLimit(paths.length === 0 ? ROOTS : paths, root);
  for (const block of over) stdout.write(`${block.file}:${block.line}: ${block.lines} lines\n`);
  stdout.write(`${over.length} comment blocks over ${LIMIT} lines\n`);
  // Not `exit()`: a pipe on Node may still be draining the list when the process would end.
  process.exitCode = over.length === 0 ? 0 : 1;
}
