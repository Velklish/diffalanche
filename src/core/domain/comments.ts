/** Writing, replying, resolving, reading back ([04-domain.md](../../../docs/reference/04-domain.md));
 * who may do which is [ADR-004](../../../docs/adr/adr-004-agent-contract.md). */
import type {
  Anchor,
  Comment,
  Reply,
  Role,
  Scope,
  Severity,
  SeveritySource,
  Side,
} from "../storage/index.ts";
import {
  confirmedBy,
  readComments,
  readDiffCache,
  readReview,
  sessionExists,
  timestamp,
  updateSession,
} from "../storage/index.ts";
import type { RepositoryChange } from "../types.ts";
import { captureAnchor, captureFromFile } from "./anchors.ts";
import { isUnanswered } from "./counters.ts";
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
type NewComment = {
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
  /** `auto` when the model chose `severity` at send time; `manual`, the default, when the writer did. */
  severitySource?: Extract<SeveritySource, "auto" | "manual">;
  body: string;
  author: string;
  role: Role;
};

type Message = {
  body: string;
  author: string;
  role: Role;
  /** The author agrees with the severity the model chose: `auto` becomes `confirmed:<author>`. */
  confirmSeverity?: boolean;
};

/** Who closes or reopens a thread. Only a human may ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)). */
export type Verdict = Actor & {
  /** Written into the thread as a reply before the thread closes. */
  note?: string;
};

/** A reopen that may also put a line comment on the line it belongs to now: the one way an
 * orphaned comment goes back to `open` (04-domain.md, "Re-anchoring"). */
export type Reopening = Verdict & {
  line?: number;
  /** The last line of a range; without it the comment is on `line` alone. */
  endLine?: number | null;
};

export type CommentFilter = {
  /** Default `all`; the CLI picks its own default. */
  status?: "open" | "resolved" | "orphaned" | "all";
  repo?: string;
  severity?: Severity;
  /** Only threads whose last message is from a human. */
  unanswered?: boolean;
};

/** Every function here starts with it: without it a missing session gets four answers, one per
 * caller and anchor level ([04-domain.md](../../../docs/reference/04-domain.md), "Comments"). */
async function assertSession(dataDir: string, session: string): Promise<void> {
  if (!(await sessionExists(dataDir, session))) {
    throw new DomainError("no-such-session", `no review session "${session}"`);
  }
}

/** The scope every read of the comments filters by: a task returns nothing outside it
 * ([04-domain.md](../../../docs/reference/04-domain.md), "Reading comments back"). */
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
type AnchorLevels = Pick<NewComment, "repo" | "path" | "line" | "endLine">;

/** The level is read off the nulls, so a line without a file or a range without a line is a
 * comment nothing can place (04-domain.md, "Anchor levels"). */
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

/** The change set anchors are taken from: `diff.json`, the one source that carries hunks
 * ([04-domain.md](../../../docs/reference/04-domain.md), "Anchor capture"). */
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

/** A file read whole, on disk or at the base revision; `null` when it is not there to read. */
export type FileSource = (
  repo: string,
  path: string,
  rev: "worktree" | { sha: string },
) => Promise<string | null>;

/** `source` lets a line the change set does not carry be anchored from the file; the server and the
 * CLI both give one (ADR-004, amendment of 2026-09-23), and without one such a line is refused. */
type AddOptions = { source?: FileSource };

/** Writes a comment. A line anchor is filled from the change set of the session. */
export async function addComment(
  dataDir: string,
  session: string,
  input: NewComment,
  options: AddOptions = {},
): Promise<Comment> {
  await assertSession(dataDir, session);
  assertAnchorLevels(input);

  const repo = input.repo ?? null;
  const path = input.path ?? null;
  const line = input.line ?? null;
  // The cheap refusal, before the anchor is read: a comment outside the scope would be stored
  // and never read back (04-domain.md, "Writing a comment").
  assertAnchorInScope(await readReview(dataDir, session), repo, path);
  const side: Side | null = line === null ? null : (input.side ?? "new");
  const anchor =
    line === null || repo === null || path === null || side === null
      ? null
      : await anchorOf(await changeSet(dataDir, session), repo, path, side, line, options.source);

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
      severitySource: input.severitySource ?? "manual",
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

/** The change set's anchor, or the file's when the change set has no such line and a source can
 * read it; a refusal the file cannot answer stays the change set's own. */
async function anchorOf(
  repositories: RepositoryChange[],
  repo: string,
  path: string,
  side: Side,
  line: number,
  source: FileSource | undefined,
): Promise<Anchor> {
  try {
    return captureAnchor(repositories, repo, path, side, line);
  } catch (error) {
    if (source === undefined || !(error instanceof DomainError)) throw error;
    if (error.code !== "line-not-in-diff") throw error;
    const repository = repositories.find((one) => one.path === repo);
    const file = repository?.files.find((one) => one.path === path) ?? null;
    // A file listed without its lines has none to anchor to, whichever side is read.
    if (file !== null && file.omitted !== null) throw error;
    const sha = repository?.base?.sha;
    const rev = side === "new" ? "worktree" : sha === undefined ? null : { sha };
    // The base has a renamed file under the name it had then.
    const at = side === "old" ? (file?.oldPath ?? path) : path;
    const text = rev === null ? null : await source(repo, at, rev);
    if (text === null) throw error;
    return captureFromFile(text, side, line, file, `${repo}/${path}`);
  }
}

/** The comment under that id inside the scope: one outside it, from a hand edit, is
 * `no-such-comment` to every reader ([04-domain.md](../../../docs/reference/04-domain.md)). */
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
    if (message.confirmSeverity === true) {
      assertConfirmable(comment, message.author);
      comment.severitySource = `confirmed:${message.author}`;
    }
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

/** Only a severity the model chose is waiting for a confirmation, and only a named author can
 * give it: `confirmed:` alone is a value the parser refuses. Either refusal writes nothing. */
function assertConfirmable(comment: Comment, author: string): void {
  if (author.trim() === "") {
    throw new DomainError(
      "invalid-author",
      `confirming the severity of ${comment.id} needs an author to name; nothing was written`,
    );
  }
  if (comment.severitySource === "auto") return;
  const by = confirmedBy(comment.severitySource);
  throw new DomainError(
    "severity-not-auto",
    by === null
      ? `the severity of ${comment.id} was chosen by its writer, so there is no automatic label ` +
          "to confirm; nothing was written"
      : `the severity of ${comment.id} is already confirmed by ${by}; nothing was written`,
  );
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

/** With `line`, the anchor is taken again there before the thread opens; an orphaned comment is
 * refused without one, since reopening it where it was would put it back on the wrong line. */
export async function reopen(
  dataDir: string,
  session: string,
  id: string,
  verdict: Reopening,
  options: AddOptions = {},
): Promise<Comment> {
  await assertSession(dataDir, session);
  assertHuman(verdict, "reopen a comment");
  const placed =
    verdict.line === undefined
      ? null
      : await replace(dataDir, session, id, verdict, options.source);
  return updateSession(dataDir, session, ({ review, comments }) => {
    const comment = find(comments, id, review.scope);
    if (placed === null && comment.status === "orphaned") {
      throw new DomainError(
        "anchor-orphaned",
        `${comment.id} lost its anchor when the code changed; reopen it with --line naming ` +
          "the line it belongs to now. Nothing was written",
      );
    }
    if (placed !== null) {
      comment.line = placed.line;
      comment.endLine = placed.endLine;
      comment.anchor = placed.anchor;
    }
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

/** The new place of a line comment a human names, its anchor captured as `addComment` takes one;
 * a comment above a line has no line to move (04-domain.md, "Re-anchoring"). */
async function replace(
  dataDir: string,
  session: string,
  id: string,
  verdict: Reopening,
  source?: FileSource,
): Promise<{ line: number; endLine: number | null; anchor: Anchor }> {
  const comment = await get(dataDir, session, id);
  const line = verdict.line as number;
  const endLine = verdict.endLine ?? null;
  if (comment.repo === null || comment.path === null || comment.line === null) {
    throw new DomainError(
      "invalid-anchor",
      `${comment.id} is on ${anchorName(comment.repo, comment.path)}, not on a line, so there ` +
        "is no line to move it to",
    );
  }
  assertAnchorLevels({ repo: comment.repo, path: comment.path, line, endLine });
  const side = comment.side ?? "new";
  const repositories = await changeSet(dataDir, session);
  const anchor = await anchorOf(repositories, comment.repo, comment.path, side, line, source);
  return { line, endLine, anchor };
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
