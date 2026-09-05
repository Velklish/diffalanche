/**
 * Comments: writing one, replying, resolving, and reading them back.
 * `docs/SPEC.md` section 5 "Comments" and "Agent", section 7 for the shape, and
 * [ADR-004](../../../docs/adr/adr-004-agent-contract.md) for who may do what.
 */
import type { Comment, Reply, Role, Severity, Side } from "../storage/index.ts";
import {
  readComments,
  readDiffCache,
  sessionExists,
  timestamp,
  updateComments,
} from "../storage/index.ts";
import type { RepositoryChange } from "../types.ts";
import { captureAnchor } from "./anchors.ts";
import { isAwaiting, isUnanswered } from "./counters.ts";
import { DomainError } from "./errors.ts";

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
export type Verdict = {
  author: string;
  role: Role;
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

/**
 * Checks that the anchor levels add up. `docs/SPEC.md` section 7 reads the
 * level off the nulls, so a line without a file or a range without a line is
 * not a level at all — it is a comment nothing can place.
 */
function assertAnchorLevels(input: NewComment): void {
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
  const side: Side | null = line === null ? null : (input.side ?? "new");
  const anchor =
    line === null || repo === null || path === null || side === null
      ? null
      : captureAnchor(await changeSet(dataDir, session), repo, path, side, line);

  return updateComments(dataDir, session, (comments) => {
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

function find(comments: Comment[], id: string): Comment {
  const comment = comments.find((one) => one.id === id);
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
  return updateComments(dataDir, session, (comments) => {
    const comment = find(comments, id);
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

/**
 * Only a human resolves. The check is here rather than in the shipped skills:
 * a skill is advice, and an agent that never read it could still close a thread
 * ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)).
 */
function assertHuman(verdict: Verdict, action: string): void {
  if (verdict.role !== "human") {
    throw new DomainError(
      "role-not-human",
      `only a human may ${action} a comment; this call came with role "${verdict.role}"`,
    );
  }
}

export async function resolve(
  dataDir: string,
  session: string,
  id: string,
  verdict: Verdict,
): Promise<Comment> {
  await assertSession(dataDir, session);
  assertHuman(verdict, "resolve");
  return updateComments(dataDir, session, (comments) => {
    const comment = find(comments, id);
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
  assertHuman(verdict, "reopen");
  return updateComments(dataDir, session, (comments) => {
    const comment = find(comments, id);
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
  return find(await readComments(dataDir, session), id);
}

/** The comments of a session, in the order they were written, filtered. */
export async function list(
  dataDir: string,
  session: string,
  filter: CommentFilter = {},
): Promise<Comment[]> {
  await assertSession(dataDir, session);
  const comments = await readComments(dataDir, session);
  const status = filter.status ?? "all";
  return comments.filter((comment) => {
    if (status !== "all" && comment.status !== status) return false;
    if (filter.repo !== undefined && comment.repo !== filter.repo) return false;
    if (filter.severity !== undefined && comment.severity !== filter.severity) return false;
    if (filter.unanswered === true && !isUnanswered(comment)) return false;
    if (filter.unanswered === false && isUnanswered(comment)) return false;
    return true;
  });
}

export { isAwaiting, isUnanswered };
