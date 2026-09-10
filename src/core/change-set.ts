/**
 * One scan of the review: every repository under the root, read against the
 * session's base, in the shape `diff.json` stores and `diff --json` prints
 * (`docs/SPEC.md` sections 5 and 7). The CLI scans here; the server switches to
 * it in DA-16 and still has its own walk until then.
 *
 * The hunks are asked for, because the anchor of a line comment is captured
 * from them and `diff.json` is the only place they are kept.
 */
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

/** The cache around a set of repositories: sorted by path, with the totals counted. */
function cache(
  root: string,
  base: BaseSpec,
  scope: Scope,
  repositories: RepositoryChange[],
  warnings: ScanWarning[],
): DiffCache {
  return {
    version: SCHEMA_VERSION,
    base,
    scope,
    root,
    repositories: [...repositories].sort((a, b) => byCodePoint(a.path, b.path)),
    totals: totalsOf(repositories),
    warnings,
  };
}

/**
 * Whether two bases name the same thing. It is compared field by field and not
 * through `formatBase`: that writes a base as the argument that produces it, so
 * a `ref` literally named `head` comes out as `head` and would pass for the
 * `head` mode — and `review.json` is edited by hand, so nothing keeps such a
 * base out of it.
 */
export function sameBase(left: BaseSpec, right: BaseSpec): boolean {
  if (left.mode === "head") return right.mode === "head";
  if (left.mode === "ref") return right.mode === "ref" && left.ref === right.ref;
  return right.mode === "branch" && (left.branch ?? null) === (right.branch ?? null);
}

/**
 * Whether two scopes name the same thing. A cache computed for another scope
 * answers a different question just as one computed against another base does:
 * it holds the repositories and the files of the scope it was read under, and
 * the entries are compared in order because that is the order they are written
 * and edited in.
 */
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

/**
 * What the scope leaves of one repository's change set. A repository the task
 * is not about comes back with nothing — files and warnings both, because a
 * warning about a repository outside the task is not this task's news — one the
 * scope holds as a whole keeps every file, and one that names paths keeps those
 * and no others.
 *
 * **The names are matched as they are written, a renamed file included.** A
 * file whose name changed is at a path the scope does not name, and nothing
 * outside the scope is shown ([ADR-010](../../docs/adr/adr-010-review-task-scope.md),
 * decision 2); what the task keeps is the path it was given, which now has
 * nothing to show — decision 5, the same answer a file that stopped changing
 * gets. Matching the old name here instead would show a file under a name the
 * scope has not, and then every reader of the comments — `list`, `show`,
 * `export` — would have to resolve the rename again, from a change set that
 * stops carrying it the moment the rename is committed.
 */
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
export type ReviewScan = {
  cache: DiffCache;
  /**
   * The path of every repository the scan found, with changes or without. A
   * caller narrowing to one repository needs it to tell a path nothing is at
   * from a repository that simply has nothing to show.
   */
  found: string[];
};

/**
 * The path of every repository under the root, with changes or without. The
 * walk reads the file system and starts no git process, so it is what a command
 * checks a `--repo` against before it does anything that writes.
 */
export async function findRepositories(config: Config): Promise<string[]> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  return found.repositories.map((repo) => repo.path);
}

/**
 * One scan of the root, inside the scope of the review task. A repository
 * without changes is not part of the review, but its warnings are kept: "ref
 * does not resolve" is why it has none.
 *
 * **The walk finds every repository; only the scoped ones are read.** Finding
 * them starts no git process, and it is what tells a repository the scope names
 * but the root has not from one that is simply quiet — while reading a
 * repository is four git processes, and a task over two repositories of
 * twenty-one must not pay for the other nineteen
 * ([ADR-010](../../docs/adr/adr-010-review-task-scope.md)).
 */
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
  const scanned = await Promise.all(
    selected.map(async (repo) =>
      filterChange(
        scope,
        await readRepositoryChange(config.root, repo.path, base, { hunks: true }),
      ),
    ),
  );
  const paths = found.repositories.map((repo) => repo.path);
  // A scope entry the walk has no repository for is named rather than dropped:
  // the entry was checked when it was written, so what this says is that the
  // repository has gone since ([01-scanner.md](../../docs/reference/01-scanner.md)).
  const missing: ScanWarning[] = (scope ?? [])
    .filter((entry) => !paths.includes(entry.repo))
    .map((entry) => ({
      path: entry.repo,
      message: "in the scope of this review task, but not a repository under the root",
    }));
  const warnings: ScanWarning[] = [
    ...found.warnings,
    ...missing,
    ...scanned.flatMap((repo) => repo.warnings.map((message) => ({ path: repo.path, message }))),
  ];
  return {
    cache: cache(
      config.root,
      base,
      scope,
      scanned.filter((repo) => repo.files.length > 0),
      warnings,
    ),
    found: paths,
  };
}

/**
 * Brings `diff.json` up to date for one repository, so a comment written right
 * after an edit anchors to the line that is there now. The repository is read
 * again rather than compared against the mtimes of its `.git` and its working
 * tree: one `git diff` on one repository costs less than walking the tree, and
 * it is right in the case a mtime comparison gets wrong — a file edited and
 * saved within the same second as the scan.
 *
 * Without a cache at all there is nothing to patch, so the whole root is
 * scanned once, which is also what the reader of the review needs next.
 *
 * The read and the write are one step under the session's lock: the watcher of
 * a running server patches the same file, and two read-modify-writes without a
 * lock overwrite each other's repositories.
 */
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
    // A cache computed against another base — or for another scope — answers a
    // different question, so patching one repository into it would leave the
    // review reading half of each. `review base` and a scope edit are what put
    // it there, and one full scan repairs it — outside the lock, because it
    // takes as long as every repository takes.
    if (previous === null || !sameBase(previous.base, base) || !sameScope(previous.scope, scope)) {
      return true;
    }
    const repositories = previous.repositories.filter((one) => one.path !== repo);
    if (change.files.length > 0) repositories.push(change);
    const warnings: ScanWarning[] = [
      ...previous.warnings.filter((one) => one.path !== repo),
      ...change.warnings.map((message) => ({ path: repo, message })),
    ];
    await held.assertHeld();
    await writeDiffCache(
      config.dataDir,
      session,
      cache(previous.root, base, scope, repositories, warnings),
    );
    return false;
  });
  if (!full) return;

  const scanned = (await scanReview(config, base, scope)).cache;
  await withLock(sessionDir(config.dataDir, session), async (held) => {
    await held.assertHeld();
    await writeDiffCache(config.dataDir, session, scanned);
  });
}
