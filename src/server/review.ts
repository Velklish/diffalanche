import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readRepositoryChange, scan } from "../core/index.ts";
import type { ReviewBundle, ScanConfig, ScanWarning } from "../core/types.ts";

const DEFAULT_CONFIG: ScanConfig = { roots: ["."], depth: 2, exclude: [] };

/** Scans the root once and returns the whole change set: the UI loads nothing lazily. */
export async function buildReviewBundle(root: string): Promise<ReviewBundle> {
  const absoluteRoot = resolve(root);
  const config = await readConfig(absoluteRoot);
  const found = await scan(absoluteRoot, config);
  const scanned = await Promise.all(
    // The renderer reads `patch`; carrying the structured hunks as well costs
    // more CPU per scrolled frame than the budget of `docs/SPEC.md` section 6 has.
    found.repositories.map((repo) =>
      readRepositoryChange(absoluteRoot, repo.path, { mode: "head" }, { hunks: false }),
    ),
  );
  const repositories = scanned.filter((repo) => repo.files.length > 0);
  const warnings: ScanWarning[] = [
    ...found.warnings,
    ...scanned.flatMap((repo) => repo.warnings.map((message) => ({ path: repo.path, message }))),
  ];
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
    warnings,
  };
}

async function readConfig(root: string): Promise<ScanConfig> {
  try {
    const raw = await readFile(join(root, ".diffalanche", "config.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ScanConfig>;
    return {
      roots: parsed.roots ?? DEFAULT_CONFIG.roots,
      depth: parsed.depth ?? DEFAULT_CONFIG.depth,
      exclude: parsed.exclude ?? DEFAULT_CONFIG.exclude,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
