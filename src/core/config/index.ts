/**
 * `config.json` and the command-line flags that override it. The result is one
 * typed `Config` with every path already resolved, so nothing downstream has to
 * know what was written in the file and what came from a flag.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { asArray, asObject, asString, asStrings, fail, parseJson } from "../storage/fields.ts";
import { dataDirOf } from "../storage/index.ts";

const run = promisify(execFile);

/** The configuration as everything downstream sees it: absolute paths, no gaps. */
export type Config = {
  /** Absolute path of the root under review. */
  root: string;
  /** Absolute path of the data directory. */
  dataDir: string;
  /** Where to look for repositories: each entry of `roots` resolved against the root. */
  roots: string[];
  /** How many levels below each entry of `roots` a repository may sit. */
  depth: number;
  /** Glob patterns of files left out of the change set. */
  exclude: string[];
  /** The name the UI signs comments with. */
  user: string;
  port: number;
  /** `language → server command`; empty until Phase 3. */
  lsp: Record<string, string[]>;
};

/** What the command line may override. Everything else comes from the file. */
export type ConfigOverrides = {
  /** `--root`, resolved against the current directory. */
  root?: string;
  /** `--data-dir`, resolved against the current directory. */
  dataDir?: string;
  /** `--port`. */
  port?: number;
};

/** Defaults without a config file: `docs/SPEC.md` section 7. */
export const DEFAULT_ROOTS: readonly string[] = ["."];
export const DEFAULT_DEPTH = 2;
export const DEFAULT_PORT = 4880;

export function configPath(dataDir: string): string {
  return resolve(dataDir, "config.json");
}

/**
 * Loads the configuration. `cwd` is the directory the command was run in: both
 * `--root` and `--data-dir` are relative to it, while everything inside the
 * file is relative to the root.
 */
export async function loadConfig(
  overrides: ConfigOverrides = {},
  cwd: string = process.cwd(),
): Promise<Config> {
  const root = resolve(cwd, overrides.root ?? ".");
  const dataDir =
    overrides.dataDir === undefined ? dataDirOf(root) : resolve(cwd, overrides.dataDir);
  const file = configPath(dataDir);
  const raw = await readConfigFile(file);

  const port = overrides.port ?? asPort(file, "port", raw.port) ?? DEFAULT_PORT;
  const roots = raw.roots === undefined ? DEFAULT_ROOTS : asStrings(file, "roots", raw.roots);

  return {
    root,
    dataDir,
    roots: roots.map((entry) => resolve(root, entry)),
    depth: asCount(file, "depth", raw.depth) ?? DEFAULT_DEPTH,
    exclude: raw.exclude === undefined ? [] : asStrings(file, "exclude", raw.exclude),
    user: raw.user === undefined ? await resolveUser(root) : asString(file, "user", raw.user),
    port,
    lsp: asLsp(file, raw.lsp),
  };
}

/** A missing `config.json` is not an error: the defaults are the configuration. */
async function readConfigFile(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return asObject(file, null, parseJson(file, text));
}

function asCount(file: string, field: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(file, field, `expected a whole number of levels, got ${JSON.stringify(value)}`);
  }
  return value;
}

function asPort(file: string, field: string, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65_535) {
    fail(file, field, `expected a port between 1 and 65535, got ${JSON.stringify(value)}`);
  }
  return value;
}

function asLsp(file: string, value: unknown): Record<string, string[]> {
  if (value === undefined) return {};
  const raw = asObject(file, "lsp", value);
  const lsp: Record<string, string[]> = {};
  for (const [language, command] of Object.entries(raw)) {
    const field = `lsp.${language}`;
    const parts = asStrings(file, field, command);
    if (asArray(file, field, command).length === 0) {
      fail(file, field, "expected a command, got an empty array");
    }
    lsp[language] = parts;
  }
  return lsp;
}

/**
 * The name comments are signed with when the file does not give one: git's own
 * `user.name` read from the root, then the name of the operating system user
 * ([ADR-002](../../../docs/adr/adr-002-stack-and-delivery.md)). Git is read
 * through the binary, and reading a configuration value writes nothing.
 */
async function resolveUser(root: string): Promise<string> {
  try {
    const { stdout } = await run("git", ["config", "user.name"], { cwd: root, encoding: "utf8" });
    const name = stdout.trim();
    if (name !== "") return name;
  } catch {
    // No git, no configuration, or no such directory: the operating system answers.
  }
  return userInfo().username;
}
