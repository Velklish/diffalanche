/** The languages the symbol index reads out of the box, as data: a grammar, the extensions it
 * owns, and a query whose captures are the definitions ([09-ml.md](../../../../docs/reference/09-ml.md)). */

import type { SymbolKind } from "../../types.ts";

export type { SymbolKind } from "../../types.ts";

/** What a definition is, named by the capture that found it: `@function`, `@class`, and so on. */
export const SYMBOL_KINDS: readonly SymbolKind[] = ["function", "class", "method", "type"];

/** One language: `grammar` is a bundled WASM file by name, `path` one of `config.json` by its
 * absolute path; `extensions` start with a dot. */
export type LanguageSpec = {
  name: string;
  grammar: string;
  path?: string;
  extensions: string[];
  query: string;
};

/** `const name = () => …` and `const name = function …`: a function by any other syntax. */
const BOUND_FUNCTIONS = `(variable_declarator name: (identifier) @function
  value: [(arrow_function) (function_expression)])`;

const TYPESCRIPT = `
(function_declaration name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(class_declaration name: (type_identifier) @class)
(abstract_class_declaration name: (type_identifier) @class)
(method_definition name: (property_identifier) @method)
(interface_declaration name: (type_identifier) @type)
(type_alias_declaration name: (type_identifier) @type)
(enum_declaration name: (identifier) @type)
${BOUND_FUNCTIONS}`;

export const BUNDLED_LANGUAGES: readonly LanguageSpec[] = [
  {
    name: "typescript",
    grammar: "tree-sitter-typescript.wasm",
    extensions: [".ts", ".mts", ".cts"],
    query: TYPESCRIPT,
  },
  { name: "tsx", grammar: "tree-sitter-tsx.wasm", extensions: [".tsx"], query: TYPESCRIPT },
  {
    name: "javascript",
    grammar: "tree-sitter-javascript.wasm",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
    query: `
(function_declaration name: (identifier) @function)
(generator_function_declaration name: (identifier) @function)
(class_declaration name: (identifier) @class)
(method_definition name: (property_identifier) @method)
${BOUND_FUNCTIONS}`,
  },
  {
    name: "c-sharp",
    grammar: "tree-sitter-c-sharp.wasm",
    extensions: [".cs"],
    query: `
(class_declaration name: (identifier) @class)
(record_declaration name: (identifier) @class)
(struct_declaration name: (identifier) @type)
(interface_declaration name: (identifier) @type)
(enum_declaration name: (identifier) @type)
(method_declaration name: (identifier) @method)`,
  },
  {
    name: "python",
    grammar: "tree-sitter-python.wasm",
    extensions: [".py", ".pyi"],
    query: `
(function_definition name: (identifier) @function)
(class_definition name: (identifier) @class)`,
  },
  {
    name: "go",
    grammar: "tree-sitter-go.wasm",
    extensions: [".go"],
    query: `
(function_declaration name: (identifier) @function)
(method_declaration name: (field_identifier) @method)
(type_spec name: (type_identifier) @type)`,
  },
  {
    name: "rust",
    grammar: "tree-sitter-rust.wasm",
    extensions: [".rs"],
    query: `
(function_item name: (identifier) @function)
(struct_item name: (type_identifier) @type)
(enum_item name: (type_identifier) @type)
(trait_item name: (type_identifier) @type)
(type_item name: (type_identifier) @type)`,
  },
  {
    name: "java",
    grammar: "tree-sitter-java.wasm",
    extensions: [".java"],
    query: `
(class_declaration name: (identifier) @class)
(record_declaration name: (identifier) @class)
(interface_declaration name: (identifier) @type)
(enum_declaration name: (identifier) @type)
(method_declaration name: (identifier) @method)`,
  },
];
