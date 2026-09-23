/** Where the tree-sitter WASM bytes come from: files beside the npm bundle, the packages in a
 * checkout, or what a compiled binary embedded ([ADR-015](../../../../docs/adr/adr-015-symbol-index-binding.md)). */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The runtime's own WASM, as `web-tree-sitter` names it. */
export const RUNTIME_WASM = "web-tree-sitter.wasm";

export type GrammarSource = {
  runtime: () => Promise<Uint8Array>;
  /** A bundled grammar by its file name: `tree-sitter-go.wasm`. */
  grammar: (file: string) => Promise<Uint8Array>;
};

let embedded: GrammarSource | null = null;

/** A compiled binary's entry hands its embedded files over before anything runs. */
export function useGrammarSource(source: GrammarSource): void {
  embedded = source;
}

/** Reads from a directory for each half: one for the npm layout, two for a checkout. */
function fromDirectories(runtimeDir: string, grammarDir: string): GrammarSource {
  return {
    runtime: () => readFile(join(runtimeDir, RUNTIME_WASM)),
    grammar: (file) => readFile(join(grammarDir, file)),
  };
}

/** `dist/grammars/` beside the npm bundle; failing that, the two packages a checkout installs —
 * named at run time, so the bundler does not resolve them into a path of the building machine. */
function onDisk(): GrammarSource {
  const beside = fileURLToPath(new URL("./grammars/", import.meta.url));
  if (existsSync(join(beside, RUNTIME_WASM))) return fromDirectories(beside, beside);
  const require = createRequire(import.meta.url);
  const runtime = require.resolve(["web-tree-sitter", RUNTIME_WASM].join("/"));
  const grammar = require.resolve(
    ["@vscode", "tree-sitter-wasm", "wasm", "tree-sitter.js"].join("/"),
  );
  return fromDirectories(dirname(runtime), dirname(grammar));
}

export function grammarSource(): GrammarSource {
  embedded ??= onDisk();
  return embedded;
}
