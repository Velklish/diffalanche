/** What a review task is about and everything read through it; `null` is the whole root, as every
 * session before DA-53 ([04-domain.md](../../../docs/reference/04-domain.md), "Scope"). */
import type { Comment, Review, Scope, ScopeEntry } from "../storage/index.ts";
import { readComments, timestamp, updateSession } from "../storage/index.ts";
import { DomainError, ScopeCommentsError } from "./errors.ts";
import type { Actor } from "./roles.ts";
import { assertHuman } from "./roles.ts";
import { assertSessionName, readSession } from "./sessions.ts";

/** How many paths of one entry a message spells out before it counts the rest. */
const NAMED_PATHS = 6;

/** The entry for a repository, or `null` when the scope does not name it. */
export function scopeEntry(scope: Scope, repo: string): ScopeEntry | null {
  if (scope === null) return null;
  return scope.find((entry) => entry.repo === repo) ?? null;
}

/** Whether the task is about this repository at all. */
export function repositoryInScope(scope: Scope, repo: string): boolean {
  return scope === null || scopeEntry(scope, repo) !== null;
}

/** Whether the task is about this file; a repository in the scope without paths is all of it. */
export function pathInScope(scope: Scope, repo: string, path: string): boolean {
  if (scope === null) return true;
  const entry = scopeEntry(scope, repo);
  if (entry === null) return false;
  return entry.paths === null || entry.paths.includes(path);
}

/** A whole-review comment is always in; one on a repository is in whichever files its entry lists,
 * since the entry is the repository ([04-domain.md](../../../docs/reference/04-domain.md), "Scope"). */
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

/** A path as `comments.json` writes one, refused rather than resolved when it leaves its
 * repository: the scope decides what is read from it (04-domain.md, "What a scope may say"). */
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

/** Checks a scope against the repositories the scan found, refusing by name; whether a file has
 * changes is not asked (04-domain.md, "What a scope may say"). */
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

/** What the task shows, it takes a comment on, by the names `filterChange` shows; the refusal names
 * the scope so an agent can act ([04-domain.md](../../../docs/reference/04-domain.md), "Scope"). */
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

/** Widening only: a path of a repository that is in whole changes nothing, and the whole root of a
 * session with no scope is as wide as a task gets (04-domain.md, "Editing a scope"). */
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

/** Refuses what it cannot do rather than passing over it: a remove that did nothing would read as
 * one that worked ([04-domain.md](../../../docs/reference/04-domain.md), "Editing a scope"). */
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
type ScopeUpdate = {
  review: Review;
  /** The comments the narrowing deleted, in the order they were written. */
  dropped: Comment[];
};

type SetScopeOptions = {
  /** Consent to deleting the comments under what is removed; without it a narrowing that would
   * delete any is refused and writes nothing. */
  dropComments?: boolean;
};

/** Replaces the scope, checked first against `found`; comments falling outside it are refused, or
 * deleted in the same write under the same lock (04-domain.md, "Writing a scope"). */
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
    // Read, not taken from the draft: asking the draft marks them written, and a change that drops
    // none must not wake the watcher ([03-storage.md](../../../docs/reference/03-storage.md)).
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

/** Closed by a human's gesture, never by counting comments; a marker, not a lock, and closing a
 * closed task keeps its `closedAt` (04-domain.md, "The status of a task"; ADR-010, ADR-004). */
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

/** The session is looked for before the role is judged, as `resolve` does: a mistyped name
 * answers "no review session", not "only a human may close". */
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
