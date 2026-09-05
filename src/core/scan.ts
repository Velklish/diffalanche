import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

/**
 * Finds the repositories under `root`: every directory holding `.git` at most
 * `depth` levels below an entry of `roots`. A repository is not scanned inside,
 * so nested submodules and worktrees under it are not listed.
 */
export async function findRepositories(
  root: string,
  roots: string[],
  depth: number,
): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const found: string[] = [];
  for (const entry of roots) {
    await walk(resolve(absoluteRoot, entry), depth, absoluteRoot, found);
  }
  return found.sort();
}

async function walk(dir: string, depth: number, root: string, found: string[]): Promise<void> {
  if (await isRepository(dir)) {
    found.push(relative(root, dir).split(sep).join("/"));
    return;
  }
  if (depth <= 0) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    await walk(join(dir, entry.name), depth - 1, root, found);
  }
}

async function isRepository(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}
