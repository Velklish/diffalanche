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
import { readRepositoryChange } from "./git/index.ts";
import { byCodePoint } from "./order.ts";
import { scan } from "./scanner/index.ts";
import type { DiffCache } from "./storage/index.ts";
import { readDiffCache, SCHEMA_VERSION, writeDiffCache } from "./storage/index.ts";
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
  repositories: RepositoryChange[],
  warnings: ScanWarning[],
): DiffCache {
  return {
    version: SCHEMA_VERSION,
    base,
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
function sameBase(left: BaseSpec, right: BaseSpec): boolean {
  if (left.mode === "head") return right.mode === "head";
  if (left.mode === "ref") return right.mode === "ref" && left.ref === right.ref;
  return right.mode === "branch" && (left.branch ?? null) === (right.branch ?? null);
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
 * One scan of the whole root. A repository without changes is not part of the
 * review, but its warnings are kept: "ref does not resolve" is why it has none.
 */
export async function scanReview(config: Config, base: BaseSpec): Promise<ReviewScan> {
  const found = await scan(config.root, {
    roots: config.roots,
    depth: config.depth,
    exclude: config.exclude,
  });
  const scanned = await Promise.all(
    found.repositories.map((repo) =>
      readRepositoryChange(config.root, repo.path, base, { hunks: true }),
    ),
  );
  const warnings: ScanWarning[] = [
    ...found.warnings,
    ...scanned.flatMap((repo) => repo.warnings.map((message) => ({ path: repo.path, message }))),
  ];
  return {
    cache: cache(
      config.root,
      base,
      scanned.filter((repo) => repo.files.length > 0),
      warnings,
    ),
    found: found.repositories.map((repo) => repo.path),
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
 */
export async function refreshRepository(
  config: Config,
  session: string,
  base: BaseSpec,
  repo: string,
): Promise<void> {
  const previous = await readDiffCache(config.dataDir, session);
  // A cache computed against another base answers a different question, so
  // patching one repository into it would leave the review reading half of
  // each. `review base` is what puts it there, and one full scan repairs it.
  if (previous === null || !sameBase(previous.base, base)) {
    await writeDiffCache(config.dataDir, session, (await scanReview(config, base)).cache);
    return;
  }
  const change = await readRepositoryChange(config.root, repo, base, { hunks: true });
  const repositories = previous.repositories.filter((one) => one.path !== repo);
  if (change.files.length > 0) repositories.push(change);
  const warnings: ScanWarning[] = [
    ...previous.warnings.filter((one) => one.path !== repo),
    ...change.warnings.map((message) => ({ path: repo, message })),
  ];
  await writeDiffCache(config.dataDir, session, cache(previous.root, base, repositories, warnings));
}
