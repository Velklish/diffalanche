/** The derived state of a thread and the counters the sidebar, the header and the thread rail
 * show (`docs/design/HANDOFF.md` sections 1.1 and 3; 04-domain.md, "Derived state"). */
import { byCodePoint } from "../order.ts";
import { type Comment, SEVERITIES, type Severity } from "../storage/types.ts";

/** The last message of a thread: the comment itself when nothing was replied. */
function lastMessageRole(comment: Comment): Comment["role"] {
  return comment.replies.at(-1)?.role ?? comment.role;
}

/** Open in every sense `docs/SPEC.md` counts one: an orphaned comment is a finding nobody has
 * closed, whose line was lost, and its own `status` tells it apart (04-domain.md). */
export function isOpen(comment: Pick<Comment, "status">): boolean {
  return comment.status === "open" || comment.status === "orphaned";
}

/** An open comment whose last message is from a human: no agent has answered it. */
export function isUnanswered(comment: Comment): boolean {
  return isOpen(comment) && lastMessageRole(comment) === "human";
}

/** An open comment whose last message is from an agent: nobody has verified it. */
export function isAwaiting(comment: Comment): boolean {
  return isOpen(comment) && lastMessageRole(comment) === "agent";
}

export type Counters = {
  total: number;
  open: number;
  resolved: number;
  unanswered: number;
  awaiting: number;
  /** Worst severity among the **open** comments of the scope; `null` when none is open. */
  severity: Severity | null;
};

type FileCounters = { path: string; counters: Counters };
type RepositoryCounters = { repo: string; counters: Counters; files: FileCounters[] };
export type ReviewCounters = { counters: Counters; repositories: RepositoryCounters[] };

function countComments(comments: Comment[]): Counters {
  const open = comments.filter(isOpen);
  return {
    total: comments.length,
    open: open.length,
    resolved: comments.length - open.length,
    unanswered: comments.filter(isUnanswered).length,
    awaiting: comments.filter(isAwaiting).length,
    severity: worstSeverity(open),
  };
}

/** The severity a scope is painted with, in storage's `SEVERITIES` order rather than a list of the
 * domain's own ([04-domain.md](../../../docs/reference/04-domain.md)). */
export function worstSeverity(comments: Comment[]): Severity | null {
  for (const severity of SEVERITIES) {
    if (comments.some((comment) => comment.severity === severity)) return severity;
  }
  return null;
}

/** The counters of the review, of every repository with comments and of every file in them,
 * sorted by name so that two calls on the same comments agree. */
export function countReview(comments: Comment[]): ReviewCounters {
  const byRepo = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (comment.repo === null) continue;
    const bucket = byRepo.get(comment.repo);
    if (bucket === undefined) byRepo.set(comment.repo, [comment]);
    else bucket.push(comment);
  }

  const repositories: RepositoryCounters[] = [];
  for (const repo of [...byRepo.keys()].sort(byCodePoint)) {
    const inRepo = byRepo.get(repo) ?? [];
    const byFile = new Map<string, Comment[]>();
    for (const comment of inRepo) {
      if (comment.path === null) continue;
      const bucket = byFile.get(comment.path);
      if (bucket === undefined) byFile.set(comment.path, [comment]);
      else bucket.push(comment);
    }
    repositories.push({
      repo,
      counters: countComments(inRepo),
      files: [...byFile.keys()].sort(byCodePoint).map((path) => ({
        path,
        counters: countComments(byFile.get(path) ?? []),
      })),
    });
  }

  return { counters: countComments(comments), repositories };
}
