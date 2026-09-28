/** One scan of the review in the shape `diff.json` stores, hunks included for anchor capture;
 * everything that reads a whole review goes through it ([02-git.md](../../docs/reference/02-git.md)). */
import type { Config } from "./config/index.ts";
import { pathInScope, repositoryInScope, scopeEntry } from "./domain/scope.ts";
import { readRepositoryChange } from "./git/index.ts";
import { byCodePoint } from "./order.ts";
import { scan } from "./scanner/index.ts";
import type { DiffCache, Scope } from "./storage/index.ts";
import {
  readDiffCache,
  SCHEMA_VERSION,
  sessionDir,
  withLock,
  writeDiffCache,
} from "./storage/index.ts";
import type { BaseSpec, RepositoryChange, ReviewTotals, ScanWarning } from "./types.ts";

/** The counters of a set of repositories, as the header of the review shows them. */
export function totalsOf(repositories: RepositoryChange[]): ReviewTotals {
  const files = repositories.reduce((sum, repo) => sum + repo.files.length, 0);
  const lines = repositories.reduce(
    (sum, repo) =>
      sum + repo.files.reduce((inner, file) => inner + file.additions + file.deletions, 0),
    0,
  );
  return { repositories: repositories.length, files, lines };
}

/** The cache around a set of repositories, every list sorted here and nowhere else: an order-only
 * change of the warnings reads downstream as a new set ([02-git.md](../../docs/reference/02-git.md)). */
function cache(
  root: string,
  base: BaseSpec,
  scope: Scope,
  repositories: RepositoryChange[],
  warnings: ScanWarning[],
  rootWarnings: ScanWarning[],
): DiffCache {
  return {
    version: SCHEMA_VERSION,
    base,
    scope,
    rootWarnings: sortWarnings(rootWarnings),
    root,
    repositories: [...repositories].sort((a, b) => byCodePoint(a.path, b.path)),
    totals: totalsOf(repositories),
    warnings: sortWarnings(warnings),
  };
}

function sortWarnings(warnings: ScanWarning[]): ScanWarning[] {
  return [...warnings].sort(
    (a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message),
  );
}

/** A cache that carries the root warnings a patch puts back. */
type PatchableCache = DiffCache & { rootWarnings: ScanWarning[] };

/** Whether one repository may be patched into this cache: it answers this base and scope, and it
 * was written with its root warnings ([02-git.md](../../docs/reference/02-git.md)). */
export function patchable(
  cached: DiffCache | null,
  base: BaseSpec,
  scope: Scope,
): cached is PatchableCache {
  return (
    cached !== null &&
    cached.rootWarnings !== undefined &&
    sameBase(cached.base, base) &&
    sameScope(cached.scope, scope)
  );
}

/** The cache with one repository's entry and warnings replaced by a fresh read of it — the one
 * patch both the CLI and the watcher write ([02-git.md](../../docs/reference/02-git.md)). */
export function replaceRepository(cached: PatchableCache, change: RepositoryChange): DiffCache {
  const repo = change.path;
  const repositories = cached.repositories.filter((one) => one.path !== repo);
  if (change.files.length > 0) repositories.push(change);
  const warnings: ScanWarning[] = [
    ...cached.warnings.filter((one) => one.path !== repo),
    ...cached.rootWarnings.filter((one) => one.path === repo),
    ...change.warnings.map((message) => ({ path: repo, message })),
  ];
  const { root, base, scope, rootWarnings } = cached;
  return cache(root, base, scope, repositories, warnings, rootWarnings);
}

/** Field by field, not through `formatBase`: a `ref` named `head`, which a hand-edited
 * `review.json` can hold, formats as `head` and would pass for the `head` mode. */
export function sameBase(left: BaseSpec, right: BaseSpec): boolean {
  if (left.mode === "head") return right.mode === "head";
  if (left.mode === "ref") return right.mode === "ref" && left.ref === right.ref;
  return right.mode === "branch" && (left.branch ?? null) === (right.branch ?? null);
}

/** `sameBase` for the other half of the cache's key; entries compare in order, the order they
 * are written and edited in ([03-storage.md](../../docs/reference/03-storage.md)). */
export function sameScope(left: Scope, right: Scope): boolean {
  if (left === null || right === null) return left === right;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    if (other === undefined || other.repo !== entry.repo) return false;
    if (entry.paths === null || other.paths === null) return entry.paths === other.paths;
    return (
      entry.paths.length === other.paths.length &&
      entry.paths.every((path, at) => other.paths?.[at] === path)
    );
  });
}

/** What the scope leaves of one repository's change set, names matched as written, a renamed file
 * included ([02-git.md](../../docs/reference/02-git.md); the rename: 04-domain.md, "Scope"). */
export function filterChange(scope: Scope, change: RepositoryChange): RepositoryChange {
  if (scope === null) return change;
  const entry = scopeEntry(scope, change.path);
  if (entry === null) return { ...change, files: [], warnings: [] };
  if (entry.paths === null) return change;
  return {
    ...change,
    files: change.files.filter((file) => pathInScope(scope, change.path, file.path)),
  };
}

/** What one scan of the root came to: the cache, and every repository it saw. */
type ReviewScan = {
  cache: DiffCache;
  /** Every repository the walk found, changed or not: how a `--repo` nothing is at is told from
   * one that has nothing to show. */
  found: string[];
};

/** Every repository under the root, changed or not; the walk starts no git process, so a command
 * checks a `--repo` against it before anything writes. */
export async function findRepositories(config: Config): Promise<string[]> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  return found.repositories.map((repo) => repo.path);
}

/** How many repositories are read at once: the width that decides how many git processes a scan
 * holds, measured rather than picked (DA-98, `docs/reference/02-git.md`). */
export const SCAN_CONCURRENCY = 8;

/** `Promise.all` over `items` with at most `limit` in flight, answering in the order they were
 * given; `tests/change-set.test.ts` holds the bound where no machine can soften it. */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next;
      next += 1;
      const item = items[at];
      if (item !== undefined) results[at] = await run(item);
    }
  };
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/** One scan of the root inside the task's scope: the walk finds every repository and only the
 * scoped ones are read, five git processes each ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)). */
export async function scanReview(
  config: Config,
  base: BaseSpec,
  scope: Scope = null,
): Promise<ReviewScan> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  const selected = found.repositories.filter((repo) => repositoryInScope(scope, repo.path));
  const scanned = await mapWithLimit(selected, SCAN_CONCURRENCY, async (repo) =>
    filterChange(scope, await readRepositoryChange(config.root, repo.path, base, { hunks: true })),
  );
  const paths = found.repositories.map((repo) => repo.path);
  // A scope entry with no repository is named, not dropped: it was checked when it was written,
  // so the repository has gone since ([02-git.md](../../docs/reference/02-git.md)).
  const missing: ScanWarning[] = (scope ?? [])
    .filter((entry) => !paths.includes(entry.repo))
    .map((entry) => ({
      path: entry.repo,
      message: "in the scope of this review task, but not a repository under the root",
    }));
  const rootWarnings: ScanWarning[] = [...found.warnings, ...missing];
  const warnings: ScanWarning[] = [
    ...rootWarnings,
    ...scanned.flatMap((repo) => repo.warnings.map((message) => ({ path: repo.path, message }))),
  ];
  return {
    cache: cache(
      config.root,
      base,
      scope,
      scanned.filter((repo) => repo.files.length > 0),
      warnings,
      rootWarnings,
    ),
    found: paths,
  };
}

/** Re-reads one repository into `diff.json` so a comment anchors to the line there now, read and
 * write under one lock as the watcher patches it too ([02-git.md](../../docs/reference/02-git.md)). */
export async function refreshRepository(
  config: Config,
  session: string,
  base: BaseSpec,
  repo: string,
  scope: Scope = null,
): Promise<void> {
  const change = filterChange(
    scope,
    await readRepositoryChange(config.root, repo, base, { hunks: true }),
  );
  const full = await withLock(sessionDir(config.dataDir, session), async (held) => {
    const previous = await readDiffCache(config.dataDir, session);
    // A cache for another base or scope gets a full scan, not a patch, run outside the lock because
    // it takes as long as every repository takes ([02-git.md](../../docs/reference/02-git.md)).
    if (!patchable(previous, base, scope)) return true;
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, replaceRepository(previous, change));
    return false;
  });
  if (!full) return;

  const scanned = (await scanReview(config, base, scope)).cache;
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, scanned);
  });
}
