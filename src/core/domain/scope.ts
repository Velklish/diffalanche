/**
 * The scope of a review task: what it is about, and what follows from that.
 * One list of entries, each a whole repository or a repository with the paths
 * the task names ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md));
 * `null` is the whole root, which is what every session written before DA-53
 * means. Nothing outside the scope is shown or returned, so this module is what
 * the change set, the comments, and the status of a task are read through.
 */
import type { Comment, Review, Scope, ScopeEntry } from "../storage/index.ts";
import { readComments, timestamp, updateSession } from "../storage/index.ts";
import { DomainError, ScopeCommentsError } from "./errors.ts";
import type { Actor } from "./roles.ts";
import { assertHuman } from "./roles.ts";
import { assertSessionName, readSession } from "./sessions.ts";

/** How many paths of one entry a message spells out before it counts the rest. */
const NAMED_PATHS = 6;

// ---------------------------------------------------------------------------
// reading a scope
// ---------------------------------------------------------------------------

/** The entry for a repository, or `null` when the scope does not name it. */
export function scopeEntry(scope: Scope, repo: string): ScopeEntry | null {
  if (scope === null) return null;
  return scope.find((entry) => entry.repo === repo) ?? null;
}

/** Whether the task is about this repository at all. */
export function repositoryInScope(scope: Scope, repo: string): boolean {
  return scope === null || scopeEntry(scope, repo) !== null;
}

/**
 * Whether the task is about this file. A repository in the scope without paths
 * is the whole repository, so every file of it is in.
 */
export function pathInScope(scope: Scope, repo: string, path: string): boolean {
  if (scope === null) return true;
  const entry = scopeEntry(scope, repo);
  if (entry === null) return false;
  return entry.paths === null || entry.paths.includes(path);
}

/**
 * Whether a comment is inside the scope. A comment on the whole review is
 * always in — it is about the task itself and hangs under no entry — and one on
 * a repository the task names is in, whichever files that entry lists: the
 * entry is the repository, and a finding about the repository sits on it.
 */
export function commentInScope(scope: Scope, comment: Comment): boolean {
  if (scope === null || comment.repo === null) return true;
  if (comment.path === null) return repositoryInScope(scope, comment.repo);
  return pathInScope(scope, comment.repo, comment.path);
}

/** The scope as a sentence: what a refusal names so the reader can act on it. */
export function formatScope(scope: Scope): string {
  if (scope === null) return "the whole root";
  return scope
    .map((entry) => {
      if (entry.paths === null) return entry.repo;
      const named = entry.paths.slice(0, NAMED_PATHS);
      const rest = entry.paths.length - named.length;
      const paths = rest === 0 ? named.join(", ") : `${named.join(", ")}, and ${rest} more`;
      return `${entry.repo} (${paths})`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// checking a scope
// ---------------------------------------------------------------------------

/**
 * A path of the scope is a path inside its repository, written the way
 * `comments.json` writes one: relative, with forward slashes, no `.` or `..` in
 * it. A path that leaves its repository is refused rather than resolved,
 * because the scope decides what is read from a repository and nothing may name
 * a file outside the one it belongs to.
 */
function assertScopePath(repo: string, path: string): void {
  const wrong =
    path === "" ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (wrong) {
    throw new DomainError("invalid-scope", `"${path}" is not a path inside ${repo}`);
  }
}

/**
 * Checks a scope against the repositories the scan found. Everything it refuses
 * is refused by name: a repository the root has not, a repository named twice —
 * one repository is one entry — and a path that is not one inside its
 * repository. Whether the file has changes is not asked: a file in the scope
 * with nothing to show is kept by the task and left off the screen
 * ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)).
 */
export function assertScope(scope: Scope, found: string[]): void {
  if (scope === null) return;
  if (scope.length === 0) {
    throw new DomainError(
      "invalid-scope",
      "a review task with an empty scope shows nothing; leave the scope out for the whole root",
    );
  }
  const seen = new Set<string>();
  for (const entry of scope) {
    if (seen.has(entry.repo)) {
      throw new DomainError("invalid-scope", `${entry.repo} is named twice in the scope`);
    }
    seen.add(entry.repo);
    if (!found.includes(entry.repo)) {
      throw new DomainError("invalid-scope", `no repository "${entry.repo}" under the root`);
    }
    if (entry.paths !== null) {
      if (entry.paths.length === 0) {
        throw new DomainError(
          "invalid-scope",
          `${entry.repo} is in the scope with no paths, which shows nothing; ` +
            "leave the paths out for the whole repository",
        );
      }
      for (const path of entry.paths) assertScopePath(entry.repo, path);
    }
  }
}

/**
 * What a comment may be written on: **what the task shows, it takes a comment
 * on.** A session with no scope takes any repository the root has, as it always
 * did; a task takes the repositories and the files its scope names, matched as
 * they are written — the same names `filterChange` shows the change set under
 * ([02-git.md](../../../docs/reference/02-git.md)), so a file the task prints
 * is a file it accepts a comment on and there is one rule rather than two.
 *
 * The refusal names the scope, because an agent that is only told "no" cannot
 * tell whether to widen the task or open its own (`docs/SPEC.md` section 9).
 */
export function assertAnchorInScope(
  review: Review,
  repo: string | null,
  path: string | null,
): void {
  if (anchorInScope(review.scope, repo, path)) return;
  throw new DomainError(
    "out-of-scope",
    `${anchorName(repo, path)} is not in the scope of review task ` +
      `"${review.name}", which is about ${formatScope(review.scope)}: widen the scope or ` +
      "open a task of its own",
  );
}

/** The condition of that refusal on its own: `addComment` asks it twice and answers differently. */
export function anchorInScope(scope: Scope, repo: string | null, path: string | null): boolean {
  if (scope === null || repo === null) return true;
  return repositoryInScope(scope, repo) && (path === null || pathInScope(scope, repo, path));
}

/** A repository, or a file inside one, as a refusal names it. */
export function anchorName(repo: string | null, path: string | null): string {
  return path === null ? (repo ?? "the review") : `${repo}/${path}`;
}

// ---------------------------------------------------------------------------
// editing a scope
// ---------------------------------------------------------------------------

/** What `review scope add` and `review scope remove` were given, before it is applied. */
export type ScopeChange = {
  /** Whole repositories. */
  repos: string[];
  /** One file of one repository each. */
  paths: { repo: string; path: string }[];
};

/** Whether the change names anything at all. */
export function isEmptyChange(change: ScopeChange): boolean {
  return change.repos.length === 0 && change.paths.length === 0;
}

/**
 * The scope with the change added. Widening only: a repository already in as a
 * whole stays a whole repository when a path of it is added, because the whole
 * already holds that path. A session with no scope covers the whole root, and
 * nothing is wider than that, so there is nothing here to add to.
 */
export function widenScope(scope: Scope, change: ScopeChange): Scope {
  if (scope === null) {
    throw new DomainError(
      "invalid-scope",
      "this review session has no scope: it is about the whole root, which is as wide as a task gets",
    );
  }
  const next: ScopeEntry[] = scope.map((entry) => ({
    repo: entry.repo,
    paths: entry.paths?.slice() ?? null,
  }));
  for (const repo of change.repos) {
    const entry = next.find((one) => one.repo === repo);
    if (entry === undefined) next.push({ repo, paths: null });
    else entry.paths = null;
  }
  for (const { repo, path } of change.paths) {
    const entry = next.find((one) => one.repo === repo);
    if (entry === undefined) {
      next.push({ repo, paths: [path] });
      continue;
    }
    // A repository that is in as a whole already covers the file.
    if (entry.paths === null) continue;
    if (!entry.paths.includes(path)) entry.paths.push(path);
  }
  return next;
}

/**
 * The scope with the change removed. Everything it cannot do is refused rather
 * than passed over: a repository or a path the scope does not have, and a path
 * of a repository the scope holds as a whole — "everything but this file" is
 * not an entry the format has, and a remove that silently did nothing would
 * read as one that worked.
 */
export function narrowScope(scope: Scope, change: ScopeChange): Scope {
  if (scope === null) {
    throw new DomainError(
      "invalid-scope",
      "this review session has no scope: it is about the whole root, and there is nothing in it to remove",
    );
  }
  let next: ScopeEntry[] = scope.map((entry) => ({
    repo: entry.repo,
    paths: entry.paths?.slice() ?? null,
  }));
  for (const repo of change.repos) {
    if (!next.some((entry) => entry.repo === repo)) {
      throw new DomainError("invalid-scope", `${repo} is not in the scope of this review task`);
    }
    next = next.filter((entry) => entry.repo !== repo);
  }
  for (const { repo, path } of change.paths) {
    const entry = next.find((one) => one.repo === repo);
    if (entry === undefined) {
      throw new DomainError("invalid-scope", `${repo} is not in the scope of this review task`);
    }
    if (entry.paths === null) {
      throw new DomainError(
        "invalid-scope",
        `${repo} is in the scope as a whole repository, so ${path} cannot be taken out of it; ` +
          "remove the repository, or remove it and add the paths the task keeps",
      );
    }
    if (!entry.paths.includes(path)) {
      throw new DomainError("invalid-scope", `${path} is not in the scope of ${repo}`);
    }
    entry.paths = entry.paths.filter((one) => one !== path);
  }
  // An entry whose last path was removed is the repository with nothing left to
  // show, which is not a state the scope has: the entry goes with it.
  next = next.filter((entry) => entry.paths === null || entry.paths.length > 0);
  if (next.length === 0) {
    throw new DomainError(
      "invalid-scope",
      "this would leave the review task about nothing; a task with an empty scope is not a state",
    );
  }
  return next;
}

/** What a scope write came to: the session as it now stands, and what it deleted. */
export type ScopeUpdate = {
  review: Review;
  /** The comments the narrowing deleted, in the order they were written. */
  dropped: Comment[];
};

export type SetScopeOptions = {
  /**
   * Consent to deleting the comments anchored under what is being removed.
   * Without it a narrowing that would delete any is refused and writes nothing.
   */
  dropComments?: boolean;
};

/**
 * Replaces the scope of a session. The comments that would fall outside the new
 * scope are counted first: without consent the call is refused with their count
 * and their ids and nothing is written, and with it they are deleted in the same
 * write, under the same lock, as the scope itself — a scope narrowed while its
 * comments waited for a second call would be a review with findings nothing can
 * reach.
 *
 * `found` is every repository the scan sees; the scope is checked against it
 * before anything is written.
 */
export async function setScope(
  dataDir: string,
  name: string,
  scope: Scope,
  found: string[],
  options: SetScopeOptions = {},
): Promise<ScopeUpdate> {
  assertSessionName(name);
  await readSession(dataDir, name);
  assertScope(scope, found);

  return updateSession(dataDir, name, async (draft) => {
    // Read rather than taken from the draft: asking the draft for the comments
    // is what marks them as written, and a scope change that dropped none must
    // not rewrite `comments.json` and wake the watcher for nothing
    // ([03-storage.md](../../../docs/reference/03-storage.md)).
    const comments = await readComments(dataDir, name);
    const dropped = comments.filter((comment) => !commentInScope(scope, comment));
    if (dropped.length > 0) {
      if (options.dropComments !== true) {
        throw new ScopeCommentsError(dropped.map((comment) => comment.id));
      }
      draft.comments = comments.filter((comment) => commentInScope(scope, comment));
    }
    draft.review = { ...draft.review, scope };
    return { review: draft.review, dropped };
  });
}

// ---------------------------------------------------------------------------
// the status of a task
// ---------------------------------------------------------------------------

/**
 * Closes a review task. A task is closed by a gesture and never by counting
 * comments, and by a human and never by an agent
 * ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)): the rule of
 * [ADR-004](../../../docs/adr/adr-004-agent-contract.md) reaches from a thread
 * to the task the threads are in, and it is the same check. Closing is a marker
 * rather than a lock — `comment`, `reply`, and `resolve` all still work on a
 * closed task. Closing one that is already closed changes nothing, so the
 * moment it was closed at stays the moment it was closed at.
 */
export async function closeSession(dataDir: string, name: string, by: Actor): Promise<Review> {
  return setStatus(dataDir, name, by, "close a review task", {
    status: "closed",
    closedAt: timestamp(),
    closedBy: by.author,
  });
}

/** Opens a closed task again, by the same gesture and the same rule that closed it. */
export async function reopenSession(dataDir: string, name: string, by: Actor): Promise<Review> {
  return setStatus(dataDir, name, by, "reopen a review task", {
    status: "open",
    closedAt: null,
    closedBy: null,
  });
}

/**
 * The session is looked for before the role is judged, the order `resolve` and
 * `reopen` use ([comments.ts](comments.ts)): a mistyped name answers "no review
 * session", not "only a human may close".
 */
async function setStatus(
  dataDir: string,
  name: string,
  by: Actor,
  action: string,
  next: Pick<Review, "status" | "closedAt" | "closedBy">,
): Promise<Review> {
  assertSessionName(name);
  const review = await readSession(dataDir, name);
  assertHuman(by, action);
  if (review.status === next.status) return review;
  return updateSession(dataDir, name, (draft) => {
    draft.review = { ...draft.review, ...next };
    return draft.review;
  });
}
