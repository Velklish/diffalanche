/**
 * Comments: writing one, replying, resolving, and reading them back.
 * `docs/SPEC.md` section 5 "Comments" and "Agent", section 7 for the shape, and
 * [ADR-004](../../../docs/adr/adr-004-agent-contract.md) for who may do what.
 */
import type { Comment, Reply, Role, Scope, Severity, Side } from "../storage/index.ts";
import {
  readComments,
  readDiffCache,
  readReview,
  sessionExists,
  timestamp,
  updateSession,
} from "../storage/index.ts";
import type { RepositoryChange } from "../types.ts";
import { captureAnchor } from "./anchors.ts";
import { isAwaiting, isUnanswered } from "./counters.ts";
import { DomainError } from "./errors.ts";
import type { Actor } from "./roles.ts";
import { assertHuman } from "./roles.ts";
import {
  anchorInScope,
  anchorName,
  assertAnchorInScope,
  commentInScope,
  formatScope,
} from "./scope.ts";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
/** `c_` plus six base36 characters ([ADR-002](../../../docs/adr/adr-002-stack-and-delivery.md)). */
const ID_LENGTH = 6;

/** Where the comment goes and what it says. The anchor is filled from the change set. */
export type NewComment = {
  /** `null` — the whole review. */
  repo?: string | null;
  /** `null` — the whole repository. */
  path?: string | null;
  /** `null` — the whole file. */
  line?: number | null;
  /** The last line of a range; `null` for a single line. */
  endLine?: number | null;
  /** Which side of the diff the line is on; `new` unless said otherwise. */
  side?: Side | null;
  severity: Severity;
  body: string;
  author: string;
  role: Role;
};

export type Message = {
  body: string;
  author: string;
  role: Role;
};

/** Who closes or reopens a thread. Only a human may ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)). */
export type Verdict = Actor & {
  /** Written into the thread as a reply before the thread closes. */
  note?: string;
};

export type CommentFilter = {
  /** Default `all`; the CLI picks its own default. */
  status?: "open" | "resolved" | "all";
  repo?: string;
  severity?: Severity;
  /** Only threads whose last message is from a human. */
  unanswered?: boolean;
};

/**
 * Every function here starts with this. Without it a session that is not there
 * comes back as an empty list from `list`, as "no such comment" from `get`, and
 * as two different refusals from `addComment`, depending on the anchor level —
 * four answers to one question.
 */
async function assertSession(dataDir: string, session: string): Promise<void> {
  if (!(await sessionExists(dataDir, session))) {
    throw new DomainError("no-such-session", `no review session "${session}"`);
  }
}

/**
 * What the session is about. Every read of the comments goes through it: a task
 * returns nothing outside its scope, so a comment that is not in it is not in
 * the answer ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)). A
 * session with no scope covers the whole root and filters nothing.
 */
async function sessionScope(dataDir: string, session: string): Promise<Scope> {
  return (await readReview(dataDir, session)).scope;
}

function newId(taken: Set<string>): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
    let id = "c_";
    for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
    if (!taken.has(id)) return id;
  }
}

/** `r_` plus a counter inside the thread, past the highest one already there. */
function nextReplyId(replies: Reply[]): string {
  let highest = 0;
  for (const reply of replies) {
    const number = Number.parseInt(reply.id.replace(/^r_/, ""), 10);
    if (Number.isInteger(number) && number > highest) highest = number;
  }
  return `r_${highest + 1}`;
}

/** The anchor of a comment, without what is written on it. */
export type AnchorLevels = Pick<NewComment, "repo" | "path" | "line" | "endLine">;

/**
 * Checks that the anchor levels add up. `docs/SPEC.md` section 7 reads the
 * level off the nulls, so a line without a file or a range without a line is
 * not a level at all — it is a comment nothing can place.
 */
export function assertAnchorLevels(input: AnchorLevels): void {
  const repo = input.repo ?? null;
  const path = input.path ?? null;
  const line = input.line ?? null;
  const endLine = input.endLine ?? null;

  if (repo === null && path !== null) {
    throw new DomainError("invalid-anchor", "a file anchor needs a repository");
  }
  if (path === null && line !== null) {
    throw new DomainError("invalid-anchor", "a line anchor needs a file");
  }
  if (line === null && endLine !== null) {
    throw new DomainError("invalid-anchor", "a range anchor needs a first line");
  }
  if (line !== null && line < 1) {
    throw new DomainError("invalid-anchor", `line ${line} is not a line number`);
  }
  if (line !== null && endLine !== null && endLine < line) {
    throw new DomainError("invalid-anchor", `the range ${line}-${endLine} runs backwards`);
  }
}

/**
 * The change set the anchor is taken from. `diff.json` is the cache a scan
 * wrote, and it is the only source that carries hunks: the review response of
 * the server drops them for speed.
 */
async function changeSet(dataDir: string, session: string): Promise<RepositoryChange[]> {
  const cache = await readDiffCache(dataDir, session);
  if (cache === null) {
    throw new DomainError(
      "line-not-in-diff",
      "this review session has never been scanned, so there is no change set to anchor to",
    );
  }
  return cache.repositories;
}

/** Writes a comment. A line anchor is filled from the change set of the session. */
export async function addComment(
  dataDir: string,
  session: string,
  input: NewComment,
): Promise<Comment> {
  await assertSession(dataDir, session);
  assertAnchorLevels(input);

  const repo = input.repo ?? null;
  const path = input.path ?? null;
  const line = input.line ?? null;
  // A comment outside the scope would be stored and never read back: `list`,
  // `show`, `export`, and the UI all answer inside the scope. A change outside
  // the task belongs to another task, and the refusal says what this one is
  // about (`docs/SPEC.md` section 9).
  assertAnchorInScope(await readReview(dataDir, session), repo, path);
  const side: Side | null = line === null ? null : (input.side ?? "new");
  const anchor =
    line === null || repo === null || path === null || side === null
      ? null
      : captureAnchor(await changeSet(dataDir, session), repo, path, side, line);

  return updateSession(dataDir, session, (draft) => {
    // The guarantee, not a repeat of the cheap refusal above, and it says so:
    // this one fires on a narrowing that landed while the comment was written.
    if (!anchorInScope(draft.review.scope, repo, path)) {
      throw new DomainError(
        "out-of-scope",
        `the scope of review task "${draft.review.name}" narrowed while this comment was being ` +
          `written: ${anchorName(repo, path)} is no longer in it, and the task is now about ` +
          `${formatScope(draft.review.scope)}. Nothing was written; widen the scope or open a ` +
          "task of its own",
      );
    }
    const comments = draft.comments;
    const comment: Comment = {
      id: newId(new Set(comments.map((one) => one.id))),
      repo,
      path,
      side,
      line,
      endLine: input.endLine ?? null,
      anchor,
      severity: input.severity,
      status: "open",
      author: input.author,
      role: input.role,
      body: input.body,
      createdAt: timestamp(),
      resolvedAt: null,
      resolvedBy: null,
      replies: [],
    };
    comments.push(comment);
    return comment;
  });
}

/**
 * The comment this session has under that id. A comment outside the scope is
 * not one of them: the task returns nothing outside itself, so `show` and
 * `list` do not have it and `reply`, `resolve`, and `reopen` must not either —
 * one question, one answer. Nothing writes such a comment; a `comments.json`
 * edited by hand is where it comes from.
 */
function find(comments: Comment[], id: string, scope: Scope = null): Comment {
  const comment = comments.find((one) => one.id === id && commentInScope(scope, one));
  if (comment === undefined) {
    throw new DomainError("no-such-comment", `no comment ${id} in this review session`);
  }
  return comment;
}

/** Adds a message to a thread. Agents answer here; so does a human. */
export async function reply(
  dataDir: string,
  session: string,
  id: string,
  message: Message,
): Promise<Comment> {
  await assertSession(dataDir, session);
  return updateSession(dataDir, session, ({ review, comments }) => {
    const comment = find(comments, id, review.scope);
    comment.replies.push({
      id: nextReplyId(comment.replies),
      author: message.author,
      role: message.role,
      body: message.body,
      createdAt: timestamp(),
    });
    return comment;
  });
}

export async function resolve(
  dataDir: string,
  session: string,
  id: string,
  verdict: Verdict,
): Promise<Comment> {
  await assertSession(dataDir, session);
  assertHuman(verdict, "resolve a comment");
  return updateSession(dataDir, session, ({ review, comments }) => {
    const comment = find(comments, id, review.scope);
    if (verdict.note !== undefined) {
      comment.replies.push({
        id: nextReplyId(comment.replies),
        author: verdict.author,
        role: verdict.role,
        body: verdict.note,
        createdAt: timestamp(),
      });
    }
    comment.status = "resolved";
    comment.resolvedAt = timestamp();
    comment.resolvedBy = verdict.author;
    return comment;
  });
}

export async function reopen(
  dataDir: string,
  session: string,
  id: string,
  verdict: Verdict,
): Promise<Comment> {
  await assertSession(dataDir, session);
  assertHuman(verdict, "reopen a comment");
  return updateSession(dataDir, session, ({ review, comments }) => {
    const comment = find(comments, id, review.scope);
    if (verdict.note !== undefined) {
      comment.replies.push({
        id: nextReplyId(comment.replies),
        author: verdict.author,
        role: verdict.role,
        body: verdict.note,
        createdAt: timestamp(),
      });
    }
    comment.status = "open";
    comment.resolvedAt = null;
    comment.resolvedBy = null;
    return comment;
  });
}

export async function get(dataDir: string, session: string, id: string): Promise<Comment> {
  await assertSession(dataDir, session);
  const scope = await sessionScope(dataDir, session);
  return find(await readComments(dataDir, session), id, scope);
}

/** The comments of a session, in the order they were written, filtered. */
export async function list(
  dataDir: string,
  session: string,
  filter: CommentFilter = {},
): Promise<Comment[]> {
  await assertSession(dataDir, session);
  const scope = await sessionScope(dataDir, session);
  const comments = await readComments(dataDir, session);
  const status = filter.status ?? "all";
  return comments.filter((comment) => {
    if (!commentInScope(scope, comment)) return false;
    if (status !== "all" && comment.status !== status) return false;
    if (filter.repo !== undefined && comment.repo !== filter.repo) return false;
    if (filter.severity !== undefined && comment.severity !== filter.severity) return false;
    if (filter.unanswered === true && !isUnanswered(comment)) return false;
    if (filter.unanswered === false && isUnanswered(comment)) return false;
    return true;
  });
}

export { isAwaiting, isUnanswered };
