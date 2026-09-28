import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { byCodePoint } from "../order.ts";
import type { Repository, ScanConfig, ScanResult, ScanWarning } from "../types.ts";

/** Finds the repositories under `root`, reading the filesystem and starting no git process
 * ([01-scanner.md](../../../docs/reference/01-scanner.md)). */
export async function scan(root: string, config: ScanConfig): Promise<ScanResult> {
  const absoluteRoot = resolve(root);
  const exclude = config.exclude.map(globToRegExp);
  const found: Found[] = [];
  const warnings: ScanWarning[] = [];
  for (const entry of config.roots) {
    await walk(resolve(absoluteRoot, entry), config.depth, {
      root: absoluteRoot,
      exclude,
      found,
      warnings,
    });
  }
  found.sort((a, b) => byCodePoint(a.repository.path, b.repository.path));
  warnings.push(...(await worktreeWarnings(found)));
  warnings.sort((a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message));
  return { repositories: found.map((one) => one.repository), warnings };
}

/** A repository with its linked worktree's main working tree; `realPath` is resolved because a
 * typed root may run through a link (01-scanner.md, "Worktrees and submodules"). */
type Found = { repository: Repository; realPath: string; mainWorkTree: string | null };

type Walk = {
  root: string;
  exclude: RegExp[];
  found: Found[];
  warnings: ScanWarning[];
};

async function walk(dir: string, depth: number, ctx: Walk): Promise<void> {
  const repository = await read(dir, ctx.root);
  if (repository) {
    // The root is not scanned inside either, and its empty path is no id, so it is a warning
    // rather than a repository (01-scanner.md, "The root itself").
    if (repository.repository.path === "") {
      ctx.warnings.push({
        path: ".",
        message:
          "root is itself a repository; it is not reviewed — put it under a subdirectory or set roots",
      });
      return;
    }
    ctx.found.push(repository);
    return;
  }
  if (depth <= 0) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    ctx.warnings.push({
      path: toRelative(dir, ctx.root),
      message: `directory cannot be read: ${codeOf(error)}`,
    });
    return;
  }
  for (const entry of entries) {
    // `isDirectory` is false for a symbolic link, so links are never followed.
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = join(dir, entry.name);
    if (excluded(entry.name, toRelative(child, ctx.root), ctx.exclude)) continue;
    await walk(child, depth - 1, ctx);
  }
}

/** Reads a candidate's `.git`: a directory is a repository, a file the pointer of a linked
 * worktree or a submodule (01-scanner.md, "Worktrees and submodules"). */
async function read(dir: string, root: string): Promise<Found | null> {
  const gitPath = join(dir, ".git");
  let gitStat: Awaited<ReturnType<typeof stat>>;
  try {
    gitStat = await stat(gitPath);
  } catch {
    return null;
  }
  const repository: Repository = {
    path: toRelative(dir, root),
    absolutePath: dir,
    kind: "repo",
  };
  const realPath = await realpath(dir).catch(() => dir);
  if (gitStat.isDirectory()) return { repository, realPath, mainWorkTree: null };
  if (!gitStat.isFile()) return null;
  const gitDir = await readGitDir(gitPath, dir);
  const main = gitDir ? mainWorkTreeOf(gitDir) : null;
  if (!main) return { repository, realPath, mainWorkTree: null };
  return { repository: { ...repository, kind: "worktree" }, realPath, mainWorkTree: main };
}

/** `.git` of a linked worktree holds one line: `gitdir: <path>`, absolute or relative to the worktree. */
async function readGitDir(gitPath: string, dir: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(gitPath, "utf8");
  } catch {
    return null;
  }
  const line = raw.split("\n", 1)[0]?.trim() ?? "";
  if (!line.startsWith("gitdir:")) return null;
  const value = line.slice("gitdir:".length).trim();
  if (!value) return null;
  return isAbsolute(value) ? resolve(value) : resolve(dir, value);
}

/** A linked worktree's git directory is `<main>/.git/worktrees/<name>`; a submodule's is
 * `<super>/.git/modules/<name>` and is not a worktree. */
function mainWorkTreeOf(gitDir: string): string | null {
  const parts = gitDir.split(sep);
  const at = parts.lastIndexOf("worktrees");
  if (at < 2 || parts[at - 1] !== ".git") return null;
  return parts.slice(0, at - 1).join(sep);
}

/** A worktree is worth a warning only when its main repository is part of the same review. */
async function worktreeWarnings(found: Found[]): Promise<ScanWarning[]> {
  const byRealPath = new Map(found.map((one) => [one.realPath, one.repository]));
  const warnings: ScanWarning[] = [];
  for (const one of found) {
    const declared = one.mainWorkTree;
    if (!declared) continue;
    // A relative `gitdir` was resolved against the directory as the walk reached
    // it, which through a symbolic link is not the path the map is keyed by.
    const mainPath = await realpath(declared).catch(() => declared);
    const main = byRealPath.get(mainPath);
    if (!main) continue;
    warnings.push({ path: one.repository.path, message: `worktree of ${main.path}` });
  }
  return warnings;
}

function toRelative(dir: string, root: string): string {
  return relative(root, dir).split(sep).join("/");
}

function excluded(name: string, path: string, exclude: RegExp[]): boolean {
  return exclude.some((pattern) => pattern.test(name) || pattern.test(path));
}

/** A glob of `exclude` as a regular expression: `**` crosses directories, `*` and `?` stay in one
 * segment, a trailing `/` is dropped (01-scanner.md, "What is skipped"). */
export function globToRegExp(glob: string): RegExp {
  const pattern = glob.endsWith("/") ? glob.slice(0, -1) : glob;
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` is any number of whole segments, so `**/group` is not `subgroup`.
        const slash = pattern[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    out += char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\]/, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown error";
}
