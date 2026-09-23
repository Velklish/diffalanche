#!/usr/bin/env bun
/**
 * Builds both delivery channels of `docs/SPEC.md` section 3, decision 2: the
 * npm bundle `dist/cli.js` for Node, and one binary per platform with the UI
 * embedded. Runs under Bun only, so `Bun.*` is allowed here.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { arch, argv, exit, platform, stderr, stdout } from "node:process";
import { RUNTIME_WASM } from "../src/core/ml/symbols/grammars.ts";
import { BUNDLED_LANGUAGES } from "../src/core/ml/symbols/languages.ts";
import { contentType } from "../src/server/assets.ts";

type Target = { platform: string; arch: string; suffix?: string };

/** The six targets the specification asks for. */
const TARGETS: Target[] = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "windows", arch: "x64", suffix: ".exe" },
  { platform: "windows", arch: "arm64", suffix: ".exe" },
];

const GENERATED = ".build";

const USAGE = `Usage: bun run build [-- --target <name>]

  --target <name>  one binary instead of six: a platform-architecture name such
                   as darwin-arm64, or "current" for the machine building
`;

/** This machine's target, spelled the way `TARGETS` spells it. */
function currentTarget(): string {
  return `${platform === "win32" ? "windows" : platform}-${arch}`;
}

/**
 * Which binaries to compile. A release builds all six; a CI job that only runs
 * the binary it built compiles one, which is six times less work on a runner
 * that throws the other five away.
 */
function parse(args: string[]): Target[] {
  let name: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      i += 1;
      const value = args[i];
      if (value === undefined) throw new Error(`--target needs a name\n\n${USAGE}`);
      name = value === "current" ? currentTarget() : value;
    } else if (arg === "--help" || arg === "-h") {
      stdout.write(USAGE);
      exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  if (name === undefined) return TARGETS;
  const chosen = TARGETS.filter((target) => `${target.platform}-${target.arch}` === name);
  if (chosen.length === 0) {
    const names = TARGETS.map((target) => `${target.platform}-${target.arch}`).join(", ");
    throw new Error(`--target: no target ${name}; one of ${names}, or current\n\n${USAGE}`);
  }
  return chosen;
}

let targets: Target[];
try {
  targets = parse(argv.slice(2));
} catch (error) {
  stderr.write(`build: ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
}

function bun(args: string[]): void {
  execFileSync("bun", args, { stdio: "inherit" });
}

/** The WASM the symbol index reads, by the name it asks for and where a checkout has it
 * ([ADR-015](../docs/adr/adr-015-symbol-index-binding.md)). */
function grammarFiles(): [string, string][] {
  const grammars = [...new Set(BUNDLED_LANGUAGES.map((language) => language.grammar))];
  return [
    [RUNTIME_WASM, join("node_modules", "web-tree-sitter", RUNTIME_WASM)],
    ...grammars.map((file): [string, string] => [
      file,
      join("node_modules", "@vscode", "tree-sitter-wasm", "wasm", file),
    ]),
  ];
}

/** The npm channel reads them from `dist/grammars/`, beside the bundle. */
function copyGrammars(): void {
  mkdirSync(join("dist", "grammars"), { recursive: true });
  let bytes = 0;
  for (const [name, from] of grammarFiles()) {
    copyFileSync(from, join("dist", "grammars", name));
    bytes += statSync(from).size;
  }
  console.log(`dist/grammars/  ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
}

/** The binary embeds them as files and hands the index a source that reads those. */
function grammarEntry(): string {
  const files = grammarFiles();
  const imports = files
    .map(
      ([, from], at) => `import g${at} from ${JSON.stringify(`../${from}`)} with { type: "file" };`,
    )
    .join("\n");
  const table = files.map(([name], at) => `  ${JSON.stringify(name)}: g${at},`).join("\n");
  return (
    `import { readFile } from "node:fs/promises";\n` +
    `import { useGrammarSource } from "../src/core/ml/symbols/grammars.ts";\n` +
    `${imports}\n\n` +
    `const EMBEDDED: Record<string, string> = {\n${table}\n};\n` +
    `useGrammarSource({\n` +
    `  runtime: () => readFile(EMBEDDED[${JSON.stringify(RUNTIME_WASM)}] as string),\n` +
    `  grammar: (file) => readFile(EMBEDDED[file] ?? file),\n` +
    `});\n\n`
  );
}

/** Every file of `dist/ui`, base64 encoded, as a module the binary bundles in. */
function generateEmbeddedUi(): string {
  const root = "dist/ui";
  const files: Record<string, { type: string; base64: string }> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const key = relative(root, path).split("\\").join("/");
      files[key] = { type: contentType(key), base64: readFileSync(path).toString("base64") };
    }
  };
  walk(root);

  const assets = join(GENERATED, "ui-assets.generated.ts");
  writeFileSync(
    assets,
    `// Generated by scripts/build.ts. Not checked in.\n` +
      `import type { EmbeddedAsset } from "../src/server/assets.ts";\n\n` +
      `export const FILES: Record<string, EmbeddedAsset> = ${JSON.stringify(files, null, 2)};\n`,
  );

  const entry = join(GENERATED, "binary.ts");
  writeFileSync(
    entry,
    `// Generated by scripts/build.ts. Not checked in.\n` +
      grammarEntry() +
      `import { processOutput } from "../src/cli/output.ts";\n` +
      `import { run } from "../src/cli/run.ts";\n` +
      `import { embeddedAssets } from "../src/server/assets.ts";\n` +
      `import { FILES } from "./ui-assets.generated.ts";\n\n` +
      `const code = await run(process.argv.slice(2), embeddedAssets(FILES), processOutput());\n` +
      `if (code !== 0) process.exit(code);\n`,
  );
  return entry;
}

function size(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * `bun build --compile` leaves a 60 MiB `.<hash>-00000000.bun-build` file in the
 * working directory, under a new name every run. Ignored by git, but it piles
 * up in a checkout, so the build that made them takes them away again.
 */
function removeCompileLeftovers(): void {
  for (const name of readdirSync(".")) {
    if (name.endsWith(".bun-build")) rmSync(name, { force: true });
  }
}

rmSync("dist", { recursive: true, force: true });
rmSync(GENERATED, { recursive: true, force: true });
mkdirSync(GENERATED, { recursive: true });

bun(["run", "build:ui"]);
// No runtime in the npm bundle until DA-41 delivers one: the embedder stays out, and a command
// that needs it says in one line that it could not be loaded (09-ml.md).
bun([
  "build",
  "src/cli/index.ts",
  "--target",
  "node",
  "--outfile",
  "dist/cli.js",
  "--external",
  "*embedder.ts",
]);
console.log(`dist/cli.js  ${size("dist/cli.js")}`);
copyGrammars();

const entry = generateEmbeddedUi();
for (const target of targets) {
  const outfile = `dist/diffalanche-${target.platform}-${target.arch}${target.suffix ?? ""}`;
  bun([
    "build",
    entry,
    "--compile",
    `--target=bun-${target.platform}-${target.arch}`,
    "--outfile",
    outfile,
  ]);
  console.log(`${outfile}  ${size(outfile)}`);
}
removeCompileLeftovers();
