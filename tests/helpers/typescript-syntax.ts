/** TypeScript as a syntax tree, through tree-sitter's grammar: TypeScript 7 exports no parser
 * ([README.md](../../docs/reference/README.md#checks-that-read-the-code)). */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Node, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);

type Parsers = { ts: Parser; tsx: Parser };

let parsers: Promise<Parsers> | null = null;

function load(): Promise<Parsers> {
  parsers ??= (async () => {
    const { Language, Parser } = await import("web-tree-sitter");
    const runtime = dirname(require.resolve("web-tree-sitter/web-tree-sitter.wasm"));
    await Parser.init({ wasmBinary: readFileSync(join(runtime, "web-tree-sitter.wasm")) });
    const grammars = dirname(require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter.js"));
    const parser = async (file: string) => {
      const made = new Parser();
      made.setLanguage(await Language.load(readFileSync(join(grammars, file))));
      return made;
    };
    return {
      ts: await parser("tree-sitter-typescript.wasm"),
      tsx: await parser("tree-sitter-tsx.wasm"),
    };
  })();
  return parsers;
}

/** The root of `text`, read with the TSX grammar when `path` is a `.tsx` file. */
export async function parseTypeScript(path: string, text: string): Promise<Node> {
  const { ts, tsx } = await load();
  const tree = (path.endsWith(".tsx") ? tsx : ts).parse(text);
  if (tree === null) throw new Error(`tree-sitter returned no tree for ${path}`);
  return tree.rootNode;
}

/** The value of a string literal, without its quotes. */
export function stringValue(node: Node): string {
  return node.namedChildren.map((part) => part.text).join("");
}
