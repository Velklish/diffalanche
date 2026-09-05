import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { findRepositories, readRepositoryChange } from "../core/index.ts";
import type { ReviewBundle } from "../core/types.ts";

type Config = { roots: string[]; depth: number };

const DEFAULT_CONFIG: Config = { roots: ["."], depth: 2 };

/** Scans the root once and returns the whole change set: the UI loads nothing lazily. */
export async function buildReviewBundle(root: string): Promise<ReviewBundle> {
  const absoluteRoot = resolve(root);
  const config = await readConfig(absoluteRoot);
  const paths = await findRepositories(absoluteRoot, config.roots, config.depth);
  const scanned = await Promise.all(paths.map((path) => readRepositoryChange(absoluteRoot, path)));
  const repositories = scanned.filter((repo) => repo.files.length > 0);
  const files = repositories.reduce((sum, repo) => sum + repo.files.length, 0);
  const lines = repositories.reduce(
    (sum, repo) =>
      sum + repo.files.reduce((inner, file) => inner + file.additions + file.deletions, 0),
    0,
  );
  return {
    root: absoluteRoot,
    repositories,
    totals: { repositories: repositories.length, files, lines },
  };
}

async function readConfig(root: string): Promise<Config> {
  try {
    const raw = await readFile(join(root, ".diffalanche", "config.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      roots: parsed.roots ?? DEFAULT_CONFIG.roots,
      depth: parsed.depth ?? DEFAULT_CONFIG.depth,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
