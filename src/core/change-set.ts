/** One scan of the review in the shape `diff.json` stores, hunks included for anchor capture;
 * everything that reads a whole review goes through it ([02-git.md](../../docs/reference/02-git.md)). */
import { join } from "node:path";
import type { Config } from "./config/index.ts";
import type { AnchorSources, Reanchored, RepositoryMove } from "./domain/reanchor.ts";
import { reanchorRepositories } from "./domain/reanchor.ts";
import { pathInScope, repositoryInScope, scopeEntry } from "./domain/scope.ts";
import { fileSourceAt } from "./git/browse.ts";
import { blameFrom, readRepositoryChange } from "./git/index.ts";
import { byCodePoint } from "./order.ts";
import { scan } from "./scanner/index.ts";
import type { DiffCache, Lock, Scope } from "./storage/index.ts";
import {
  commentsPath,
  readDiffCache,
  SCHEMA_VERSION,
  StorageError,
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
): Promise<ChangeSetWrite> {
  const change = filterChange(
    scope,
    await readRepositoryChange(config.root, repo, base, { hunks: true }),
  );
  const patched = await withLock(sessionDir(config.dataDir, session), async (held) => {
    const previous = await readDiffCache(config.dataDir, session);
    // A cache for another base or scope gets a full scan, not a patch, run outside the lock because
    // it takes as long as every repository takes ([02-git.md](../../docs/reference/02-git.md)).
    if (!patchable(previous, base, scope)) return null;
    return writeChangeSet(config, session, held, replaceRepository(previous, change), previous);
  });
  if (patched !== null) return patched;

  const scanned = (await scanReview(config, base, scope)).cache;
  return withLock(sessionDir(config.dataDir, session), (held) =>
    writeChangeSet(config, session, held, scanned),
  );
}

/** Whether the recomputed entry says anything the cached one did not; the patch is the content,
 * so comparing it is comparing the change itself. */
export function sameChange(before: RepositoryChange | null, after: RepositoryChange): boolean {
  if (before === null) return after.files.length === 0;
  if (before.branch !== after.branch) return false;
  if (before.files.length !== after.files.length) return false;
  if (before.warnings.join("\n") !== after.warnings.join("\n")) return false;
  if (before.base?.sha !== after.base?.sha || before.base?.ref !== after.base?.ref) return false;
  return before.files.every((file, index) => {
    const other = after.files[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.omitted === other.omitted &&
      file.patch === other.patch
    );
  });
}

/** `sameChange` where either side may be no entry, which is a repository with no changes. */
function sameEntry(before: RepositoryChange | null, after: RepositoryChange | null): boolean {
  if (after === null) return before === null || before.files.length === 0;
  return sameChange(before, after);
}

/** Re-anchoring's reads of the root: files as anchor capture reads them, history through blame. */
export function anchorSources(root: string): AnchorSources {
  return {
    source: fileSourceAt(root),
    blame: (repo, path, boundary, at) => blameFrom(join(root, repo), path, boundary, at),
  };
}

/** What a write of `diff.json` did to the comments: the pass, or the `comments.json` that could
 * not be read, which leaves every comment where it was (04-domain.md, "Re-anchoring"). */
type ChangeSetWrite = Reanchored & { unreadable: StorageError | null };

/** Writes `diff.json` in the caller's hold of the session's lock, then re-anchors in the same hold
 * the comments of every repository whose entry it replaced: the one path every writer takes. */
export async function writeChangeSet(
  config: Config,
  session: string,
  held: Lock,
  next: DiffCache,
  previous?: DiffCache | null,
): Promise<ChangeSetWrite> {
  const was = previous === undefined ? await readDiffCache(config.dataDir, session) : previous;
  await held.assertHeld();
  await writeDiffCache(config.dataDir, session, next);
  // Nothing written before says where the lines were, so the first scan moves nothing.
  if (was === null) return { moved: [], orphaned: [], unreadable: null };
  const paths = new Set([...was.repositories, ...next.repositories].map((one) => one.path));
  const moves: RepositoryMove[] = [];
  for (const repo of [...paths].sort(byCodePoint)) {
    const before = was.repositories.find((one) => one.path === repo) ?? null;
    const after = next.repositories.find((one) => one.path === repo) ?? null;
    if (!sameEntry(before, after)) moves.push({ repo, before, after });
  }
  try {
    const sources = anchorSources(config.root);
    const done = await reanchorRepositories(config.dataDir, session, moves, sources, held);
    return { ...done, unreadable: null };
  } catch (error) {
    // The comments' own file is theirs to report; `diff.json` is written all the same.
    const file = commentsPath(config.dataDir, session);
    if (error instanceof StorageError && error.file === file) {
      return { moved: [], orphaned: [], unreadable: error };
    }
    throw error;
  }
}
