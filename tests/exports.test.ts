/** Every export is imported by another file: `noUnusedLocals` does not see an exported symbol, so
 * a needless `export` is how a dead one escapes the typecheck (DA-59, docs/reference/README.md). */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import type { Node } from "web-tree-sitter";
import { parseTypeScript, stringValue } from "./helpers/typescript-syntax.ts";

const ROOT = join(import.meta.dirname, "..");

/** Exports nothing imports that stay exported on purpose, by file, each with the reason. */
const KEPT: Record<string, Record<string, string>> = {
  "src/core/ml/symbols/grammars.ts": {
    useGrammarSource: "the binary's entry imports it, and scripts/build.ts:125 writes that entry",
  },
  "src/core/ml/embed/model.ts": {
    ModelFile:
      "imported by src/core/ml/embed/delivery.ts of the ml2 track (DA-41); drop when the " +
      "second of gates and ml2 lands",
  },
  "src/server/assets.ts": {
    embeddedAssets: "the binary's entry imports it, and scripts/build.ts:167 writes that entry",
    EmbeddedAsset: "the binary's generated asset table imports it (scripts/build.ts:156)",
  },
};

/** `every`: a namespace import, a star, or a dynamic import whose names cannot be read. */
type Import = { module: string; names: readonly string[] | "every" };
/** A name a file exports: where, and whether it passes another file's name on. */
type Export = { line: number; reexport: boolean };
/** What a file exports — its declarations, and its re-exports by name or as a namespace — the
 * files it passes through with `export *`, and what it takes from other files. */
type Module = {
  exports: Map<string, Export>;
  stars: { module: string; line: number }[];
  imports: Import[];
};
type Unused = { path: string; name: string; line: number };

function resolve(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.join(posix.dirname(from), specifier.split("?")[0] ?? "");
  for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (known.has(base + suffix)) return base + suffix;
  }
  return null;
}

function declaredNames(declaration: Node): string[] {
  if (declaration.type === "ambient_declaration") {
    return declaration.namedChildren.flatMap(declaredNames);
  }
  if (declaration.type === "lexical_declaration" || declaration.type === "variable_declaration") {
    return declaration.namedChildren
      .filter((child) => child.type === "variable_declarator")
      .flatMap((declarator) => {
        const name = declarator.childForFieldName("name");
        if (name === null) return [];
        if (name.type === "identifier") return [name.text];
        const bound = ["identifier", "shorthand_property_identifier_pattern"];
        return name.descendantsOfType(bound).map((node) => node.text);
      });
  }
  const name = declaration.childForFieldName("name");
  return name === null ? [] : [name.text];
}

/** The names a clause of `{ a, b as c }` takes from its source, whatever it calls them here. */
function specifiedNames(list: Node, type: string): string[] {
  return list.namedChildren
    .filter((specifier) => specifier.type === type)
    .flatMap((specifier) => specifier.childForFieldName("name")?.text ?? []);
}

/** What a dynamic `import()` takes: the names destructured from it or read off the binding it
 * lands in; anything else, every name. */
function dynamicNames(call: Node, root: Node): readonly string[] | "every" {
  let at = call;
  while (at.parent?.type === "await_expression" || at.parent?.type === "parenthesized_expression") {
    at = at.parent;
  }
  const parent = at.parent;
  if (parent?.type === "member_expression") {
    return [parent.childForFieldName("property")?.text ?? ""];
  }
  const bound = parent?.type === "variable_declarator" ? parent.childForFieldName("name") : null;
  if (bound?.type === "object_pattern") {
    return bound.namedChildren.flatMap((part) =>
      part.type === "shorthand_property_identifier_pattern"
        ? [part.text]
        : part.type === "pair_pattern"
          ? [part.childForFieldName("key")?.text ?? ""]
          : [],
    );
  }
  if (bound?.type !== "identifier") return "every";
  return root
    .descendantsOfType("member_expression")
    .filter((member) => member.childForFieldName("object")?.text === bound.text)
    .map((member) => member.childForFieldName("property")?.text ?? "");
}

async function readModule(path: string, text: string, known: ReadonlySet<string>) {
  const root = await parseTypeScript(path, text);
  const module: Module = { exports: new Map(), stars: [], imports: [] };
  const target = (node: Node | null) =>
    node === null ? null : resolve(path, stringValue(node), known);
  const child = (node: Node, type: string) => node.namedChildren.find((c) => c.type === type);
  for (const statement of root.namedChildren) {
    const from = target(statement.childForFieldName("source"));
    if (statement.type === "import_statement") {
      const clause = child(statement, "import_clause");
      if (from === null || clause === undefined) continue;
      const named = child(clause, "named_imports");
      const names = named === undefined ? [] : specifiedNames(named, "import_specifier");
      if (child(clause, "identifier") !== undefined) names.push("default");
      const every = child(clause, "namespace_import") !== undefined;
      module.imports.push({ module: from, names: every ? "every" : names });
    }
    if (statement.type !== "export_statement") continue;
    const line = statement.startPosition.row + 1;
    const own = (name: string) => module.exports.set(name, { line, reexport: false });
    const passed = (name: string) => module.exports.set(name, { line, reexport: true });
    const declaration = statement.childForFieldName("declaration");
    const clause = child(statement, "export_clause");
    const namespace = child(statement, "namespace_export");
    if (statement.children.some((token) => token.type === "default")) {
      own("default");
    } else if (declaration !== null) {
      for (const name of declaredNames(declaration)) own(name);
    } else if (clause !== undefined) {
      // A re-export uses its source, and the name it publishes needs an importer of its own.
      for (const specifier of clause.namedChildren) {
        const name = specifier.childForFieldName("alias") ?? specifier.childForFieldName("name");
        if (name !== null) (from === null ? own : passed)(name.text);
      }
      if (from !== null) {
        module.imports.push({ module: from, names: specifiedNames(clause, "export_specifier") });
      }
    } else if (namespace !== undefined && from !== null) {
      passed(namespace.namedChildren.at(-1)?.text ?? "");
      module.imports.push({ module: from, names: "every" });
    } else if (from !== null) {
      module.stars.push({ module: from, line });
      module.imports.push({ module: from, names: "every" });
    }
  }
  for (const call of root.descendantsOfType("call_expression")) {
    const argument = call.childForFieldName("arguments")?.namedChildren[0];
    if (call.childForFieldName("function")?.type !== "import" || argument?.type !== "string") {
      continue;
    }
    const from = target(argument);
    if (from !== null) module.imports.push({ module: from, names: dynamicNames(call, root) });
  }
  return module;
}

/** The TypeScript files an entry point names: `bin`, `main`, `exports` and the scripts of
 * package.json, a `<script src>`, and plain strings in top-level scripts/, e2e/ and perf/ files. */
async function entryPoints(files: Record<string, string>): Promise<Set<string>> {
  const known = new Set(Object.keys(files));
  const roots = new Set<string>();
  const take = (from: string, value: string) => {
    for (const token of value.split(/[\s"'`]+/)) {
      for (const path of [token.replace(/^\.\//, ""), posix.join(posix.dirname(from), token)]) {
        if (/\.tsx?$/.test(path) && known.has(path)) roots.add(path);
      }
    }
  };
  const strings = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(strings)
        : [];
  for (const [path, text] of Object.entries(files)) {
    if (path === "package.json") {
      const { bin, main, exports, scripts } = JSON.parse(text) as Record<string, unknown>;
      for (const value of strings([bin, main, exports, scripts])) take(path, value);
    } else if (path.endsWith(".html")) {
      for (const [, src = ""] of text.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) take(path, src);
    } else if (/^(scripts|e2e|perf)\/[^/]+\.ts$|^[^/]+\.config\.ts$/.test(path)) {
      // Plain strings: a module specifier is an import, and a template is generated code.
      const root = await parseTypeScript(path, text);
      for (const node of root.descendantsOfType("string")) {
        const parent = node.parent;
        const specifier =
          parent?.type === "import_statement" ||
          parent?.type === "export_statement" ||
          parent?.parent?.childForFieldName("function")?.type === "import";
        if (!specifier) take(path, node.text);
      }
    }
  }
  return roots;
}

/** Every name a module exports, `export *` included, each with where it is exported. */
function namesOf(
  modules: ReadonlyMap<string, Module>,
  path: string,
  seen = new Set<string>(),
): Map<string, Export> {
  const module = modules.get(path);
  if (module === undefined || seen.has(path)) return new Map();
  seen.add(path);
  const names = new Map(module.exports);
  for (const star of module.stars) {
    for (const name of namesOf(modules, star.module, seen).keys()) {
      if (name !== "default" && !names.has(name)) {
        names.set(name, { line: star.line, reexport: true });
      }
    }
  }
  return names;
}

/** The exports of `modules` no other file imports; an entry point's re-exports are its
 * published surface and are not held to that. */
function unusedExports(
  modules: ReadonlyMap<string, Module>,
  roots: ReadonlySet<string> = new Set(),
): Unused[] {
  const used = new Set<string>();
  for (const [path, module] of modules) {
    for (const { module: from, names } of module.imports) {
      const taken = names === "every" ? [...namesOf(modules, from).keys()] : names;
      if (from !== path) for (const name of taken) used.add(`${from}#${name}`);
    }
  }
  const unused: Unused[] = [];
  for (const path of modules.keys()) {
    for (const [name, { line, reexport }] of namesOf(modules, path)) {
      if (name === "default" || used.has(`${path}#${name}`)) continue;
      if (!(reexport && roots.has(path))) unused.push({ path, name, line });
    }
  }
  return unused;
}

async function modulesOf(files: Record<string, string>): Promise<Map<string, Module>> {
  const sources = Object.keys(files).filter((path) => /\.tsx?$/.test(path));
  const known = new Set(sources);
  const modules = new Map<string, Module>();
  for (const path of sources) {
    modules.set(path, await readModule(path, files[path] ?? "", known));
  }
  return modules;
}

/** Every TypeScript file git would commit, tracked or not yet added, declarations aside; and the
 * package.json and pages that name entry points. */
function repositoryFiles(): Record<string, string> {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--"].concat([
      "*.ts",
      "*.tsx",
      "package.json",
      "src/*.html",
    ]),
    { cwd: ROOT, encoding: "utf8" },
  );
  const files: Record<string, string> = {};
  for (const path of listed.split("\0")) {
    if (path === "" || path.endsWith(".d.ts")) continue;
    try {
      files[path] = readFileSync(join(ROOT, path), "utf8");
    } catch {
      // In the index and deleted from the working tree: not a module any more.
    }
  }
  return files;
}

const named = (unused: Unused[]) => unused.map(({ path, name }) => `${path}#${name}`).sort();

describe("the export check", () => {
  it("counts an import and a re-export as a use, and an export alone as none", async () => {
    const modules = await modulesOf({
      "a.ts": "export const used = 1;\nexport const idle = 2;\nexport type Shape = { a: 1 };",
      "b.ts": 'import { used as u } from "./a";\nexport { type Shape as Form } from "./a.ts";',
      "c.ts": "const local = 3;\nexport { local as renamed };",
      "d.ts": 'import type { Form } from "./b.ts";',
    });
    expect(named(unusedExports(modules))).toEqual(["a.ts#idle", "c.ts#renamed"]);
  });

  it("takes every name through a namespace import or a star, and the said ones dynamically", async () => {
    const modules = await modulesOf({
      "a.ts": "export const one = 1;\nexport function two() {}",
      "b.ts": 'import * as a from "./a.ts";',
      "c.ts": "export type Three = 3;\nexport interface Four {}",
      "d.ts": 'export * from "./c.ts";',
      "e.ts": 'import type { Three, Four } from "./d.ts";',
      "f.ts": "export const five = 5;\nexport const six = 6;\nexport const seven = 7;",
      "g.ts": 'const { five } = await import("./f.ts");\n// six is only said here',
      "h.ts": 'const f = await import("./f.ts");\nconsole.log(f.seven);',
    });
    expect(named(unusedExports(modules))).toEqual(["f.ts#six"]);
  });

  it("does not count a use inside the exporting file, nor a default export", async () => {
    const modules = await modulesOf({
      "a.ts": "export const alone = 1;\nconsole.log(alone);\nexport default alone;",
      "b.ts": "export default function named() {}",
      "c.ts": "export default class Named {}",
      "d.ts": 'import n from "./b.ts";\nimport C from "./c.ts";',
    });
    expect(named(unusedExports(modules))).toEqual(["a.ts#alone"]);
  });

  it("holds a barrel's names to an importer each, and then the source", async () => {
    const source = "export const kept = 1;\nexport const idle = 2;";
    const user = 'import { kept } from "./barrel.ts";';
    const first = await modulesOf({
      "a.ts": source,
      "barrel.ts": 'export { kept, idle } from "./a.ts";',
      "user.ts": user,
    });
    expect(named(unusedExports(first))).toEqual(["barrel.ts#idle"]);
    // The second pass, once the barrel stops publishing it: now the source's export is unused.
    const second = await modulesOf({
      "a.ts": source,
      "barrel.ts": 'export { kept } from "./a.ts";',
      "user.ts": user,
    });
    expect(named(unusedExports(second))).toEqual(["a.ts#idle"]);
  });

  it("holds a star's names and an `export * as` to importers of the barrel", async () => {
    const modules = await modulesOf({
      "a.ts": "export const one = 1;\nexport const two = 2;",
      "stars.ts": 'export * from "./a.ts";',
      "space.ts": 'export * as helpers from "./a.ts";\nexport * as unread from "./a.ts";',
      "user.ts": 'import { one } from "./stars.ts";\nimport { helpers } from "./space.ts";',
    });
    expect(named(unusedExports(modules))).toEqual(["space.ts#unread", "stars.ts#two"]);
  });

  it("keeps what an entry point re-exports, named by package.json, a page or a build script", async () => {
    const files = {
      "package.json": JSON.stringify({ bin: { tool: "./cli.ts" }, scripts: { dev: "bun dev.ts" } }),
      "ui/index.html": '<script type="module" src="./main.ts"></script>',
      "scripts/build.ts": 'build(["lib/index.ts", "--outdir", "dist"]);',
      "a.ts": "export const one = 1;\nexport const two = 2;\nexport const three = 3;",
      "cli.ts": 'export { one } from "./a.ts";',
      "dev.ts": 'export { two } from "./a.ts";\nexport const own = 4;',
      "ui/main.ts": 'export { three } from "../a.ts";',
      "lib/index.ts": 'export * from "../a.ts";',
      "other.ts": 'export { one } from "./a.ts";',
    };
    const roots = await entryPoints(files);
    expect([...roots].sort()).toEqual(["cli.ts", "dev.ts", "lib/index.ts", "ui/main.ts"]);
    // An entry point's own declarations are held like any other file's; a non-entry barrel too.
    expect(named(unusedExports(await modulesOf(files), roots))).toEqual([
      "dev.ts#own",
      "other.ts#one",
    ]);
  });
});

describe("the repository's exports", () => {
  const scanned = (async () => {
    const files = repositoryFiles();
    const modules = await modulesOf(files);
    const roots = await entryPoints(files);
    return { files, modules, roots, unused: unusedExports(modules, roots) };
  })();

  it("are each imported by another file, or kept with a reason", async () => {
    const { files, modules, roots, unused } = await scanned;
    // Guards the guard: a listing, a parse or an entry reading that found nothing would pass.
    expect(Object.keys(files).length).toBeGreaterThan(100);
    expect(modules.get("src/server/app.ts")?.exports.has("createApp")).toBe(true);
    expect([...roots]).toEqual(expect.arrayContaining(["src/cli/index.ts", "src/ui/main.tsx"]));
    const stray = unused.filter(({ path, name }) => !KEPT[path]?.[name]);
    expect(
      stray.map(({ path, name, line }) => `${path}:${line} ${name}`),
      "exported and imported by no other file — drop the `export` (or the name from the " +
        "barrel), import it where it is meant to be used, or add it to KEPT in " +
        "tests/exports.test.ts with the reason it is public (docs/reference/README.md)",
    ).toEqual([]);
  });

  it("keeps no reason for an export that is imported or gone", async () => {
    const unused = new Set(named((await scanned).unused));
    const kept = Object.entries(KEPT).flatMap(([path, entries]) =>
      Object.keys(entries).map((name) => `${path}#${name}`),
    );
    expect(kept.filter((entry) => !unused.has(entry))).toEqual([]);
  });
});
