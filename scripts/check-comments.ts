/** `bun run check:comments`: every comment block over two lines, the rule of ADR-011
 * ([11-perf.md](../docs/reference/11-perf.md#the-comment-gate)). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, relative, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

export const ROOTS = ["src", "tests", "e2e", "perf", "scripts", ".github"];
const SLASH = new Set([".ts", ".tsx", ".css"]);
const HASH = new Set([".yml", ".yaml", ".sh"]);
const LIMIT = 2;

type Block = { file: string; line: number; lines: number };
type Kind = "slash" | "hash" | "ts" | "tsx" | "css" | "yaml" | "sh";
type Comment = { start: number; end: number; line: number; lines: number; single: boolean };

// The grammar package's runtime keeps this build-time gate separate from the symbol index's WASM.
const require = createRequire(import.meta.url);
const { Parser, Language } =
  require("@vscode/tree-sitter-wasm") as typeof import("@vscode/tree-sitter-wasm");
await Parser.init();
const languages = new Map(
  await Promise.all(
    ["typescript", "tsx", "bash"].map(
      async (name) =>
        [
          name,
          await Language.load(
            require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${name}.wasm`),
          ),
        ] as const,
    ),
  ),
);

function parsedComments(text: string, kind: Kind): Comment[] {
  const name = kind === "sh" ? "bash" : kind === "ts" ? "typescript" : "tsx";
  const parser = new Parser();
  parser.setLanguage(languages.get(name) as import("@vscode/tree-sitter-wasm").Language);
  const tree = parser.parse(text);
  if (tree === null) throw new Error(`could not parse ${name} comments`);
  const comments: Comment[] = [];
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      if (node.type === "comment") {
        if (!(node.startIndex === 0 && node.text.startsWith("#!"))) {
          comments.push({
            start: node.startIndex,
            end: node.endIndex,
            line: node.startPosition.row + 1,
            lines: node.endPosition.row - node.startPosition.row + 1,
            single: node.text.startsWith("//") || node.text.startsWith("#"),
          });
        }
      } else if (cursor.gotoFirstChild()) continue;
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return comments;
      }
    }
  } finally {
    cursor.delete();
    tree.delete();
    parser.delete();
  }
}

function cssComments(text: string): Comment[] {
  const comments: Comment[] = [];
  let index = 0;
  let line = 1;
  const advance = (end: number) => {
    line += text.slice(index, end).split("\n").length - 1;
    index = end;
  };
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      const start = index;
      const first = line;
      advance(end);
      comments.push({ start, end, line: first, lines: line - first + 1, single: false });
      continue;
    }
    const char = text[index];
    const url =
      /^url\(/i.test(text.slice(index, index + 4)) &&
      (index === 0 || !/[\w-]/.test(text[index - 1] as string));
    if (char === '"' || char === "'" || url) {
      let quote = url ? "" : char;
      let end = index + (url ? 4 : 1);
      while (end < text.length) {
        const next = text[end];
        if (next === "\\") {
          end += text[end + 1] === "\r" && text[end + 2] === "\n" ? 3 : 2;
          continue;
        }
        if (quote !== "") {
          if (next === quote) {
            end += 1;
            quote = "";
            if (!url) break;
            continue;
          }
          if (next === "\n" || next === "\r") break;
        } else if (next === '"' || next === "'") quote = next;
        else if (next === ")") {
          end += 1;
          break;
        }
        end += 1;
      }
      advance(Math.min(end, text.length));
    } else if (char === "\\") advance(Math.min(index + 2, text.length));
    else advance(index + 1);
  }
  return comments;
}

function yamlComments(text: string): Comment[] {
  const comments: Comment[] = [];
  let quote = "";
  let offset = 0;
  let flow = 0;
  let plainParent: number | null = null;
  let scalar: { parent: number; indent: number | null } | null = null;
  for (const [index, row] of text.split("\n").entries()) {
    if (row.trim() === "") {
      offset += row.length + 1;
      continue;
    }
    const indent = row.match(/^ */)?.[0].length ?? 0;
    if (scalar !== null) {
      scalar.indent ??= indent > scalar.parent ? indent : null;
      if (scalar.indent === null || indent < scalar.indent) scalar = null;
    }
    if (scalar === null) {
      let end = row.length;
      let plain = plainParent !== null && indent > plainParent && flow === 0;
      let tokenStart = !plain;
      if (!plain) plainParent = null;
      for (let column = 0; column < row.length; column += 1) {
        const char = row[column];
        if (quote !== "") {
          if (quote === '"' && char === "\\") column += 1;
          else if (char === quote) {
            if (quote === "'" && row[column + 1] === "'") column += 1;
            else quote = "";
          }
        } else if ((char === '"' || char === "'") && tokenStart) {
          quote = char;
          tokenStart = false;
          plain = false;
        } else if (char === "#" && (column === 0 || /\s/.test(row[column - 1] as string))) {
          end = column;
          comments.push({
            start: offset + column,
            end: offset + row.replace(/\r$/, "").length,
            line: index + 1,
            lines: 1,
            single: true,
          });
          break;
        } else if ((char === "[" || char === "{") && (tokenStart || flow > 0)) {
          flow += 1;
          tokenStart = true;
          plain = false;
        } else if ((char === "]" || char === "}") && flow > 0) {
          flow -= 1;
          tokenStart = false;
          plain = false;
        } else if (
          (char === ":" && (flow > 0 || /\s/.test(row[column + 1] ?? " "))) ||
          (flow > 0 && char === ",")
        ) {
          tokenStart = true;
          plain = false;
        } else if (
          tokenStart &&
          (char === "-" || char === "?") &&
          /\s/.test(row[column + 1] ?? " ")
        ) {
          tokenStart = true;
        } else if (column === 0 && /^(?:---|\.\.\.)(?:\s|$)/.test(row)) {
          column = 2;
          tokenStart = true;
        } else if (tokenStart && (char === "&" || char === "!")) {
          while (column + 1 < row.length && !/\s/.test(row[column + 1] as string)) column += 1;
        } else if (char !== undefined && !/\s/.test(char)) {
          tokenStart = false;
          plain = true;
        }
      }
      const header =
        quote === ""
          ? /(?:^|:[ \t]+|-[ \t]+)(?:[!&]\S+[ \t]+)*[|>]([+-]?[1-9]?|[1-9][+-]?)[ \t\r]*$/.exec(
              row.slice(0, end),
            )
          : null;
      if (header !== null) {
        const parent = Math.max(
          indent,
          row.slice(0, header.index).match(/^(?: *- +)*/)?.[0].length ?? 0,
        );
        const explicit = /[1-9]/.exec(header[1] ?? "");
        scalar = { parent, indent: explicit === null ? null : parent + Number(explicit[0]) };
        plainParent = null;
      } else if (plain && quote === "" && flow === 0) {
        plainParent ??= indent;
      }
    }
    offset += row.length + 1;
  }
  return comments;
}

/** The blocks of one file's text, longer than the limit or not. */
export function blocks(text: string, kind: Kind): { line: number; lines: number }[] {
  const found: { line: number; lines: number }[] = [];
  const comments =
    kind === "yaml"
      ? yamlComments(text)
      : kind === "css"
        ? cssComments(text)
        : parsedComments(text, kind === "hash" ? "sh" : kind);
  let previous: Comment | undefined;
  for (const comment of comments) {
    const last = found.at(-1);
    if (
      last !== undefined &&
      previous?.single &&
      comment.single &&
      comment.line === previous.line + 1 &&
      /^\r?\n[ \t]*$/.test(text.slice(previous.end, comment.start))
    ) {
      last.lines += 1;
    } else found.push({ line: comment.line, lines: comment.lines });
    previous = comment;
  }
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
    const kind = SLASH.has(extension)
      ? (extension.slice(1) as "ts" | "tsx" | "css")
      : HASH.has(extension)
        ? extension === ".sh"
          ? "sh"
          : "yaml"
        : null;
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
