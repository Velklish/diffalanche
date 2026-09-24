/**
 * Everything the domain refuses is one error type with a code. The CLI turns
 * any of them into exit code 1 and the message; the API turns the code into a
 * status. A caller that wants to tell one refusal from another reads `code`,
 * never the message.
 */
export type DomainErrorCode =
  /** A session name outside the allowed character set, or a reserved one. */
  | "invalid-name"
  /** A base argument that is neither `head`, `branch`, `branch:<name>`, nor a ref. */
  | "invalid-base"
  /** `review new` on a name that is already a session. */
  | "session-exists"
  /** A named session that is not in the data directory. */
  | "no-such-session"
  /** No `--review` and no `current` pointer: nothing says which session to use. */
  | "no-current-session"
  /** A comment id that is not in the session. */
  | "no-such-comment"
  /** An anchor whose levels do not add up: a line without a file, a range that runs backwards. */
  | "invalid-anchor"
  /** `resolve` or `reopen` from anything but a human ([ADR-004](../../../docs/adr/adr-004-agent-contract.md)). */
  | "role-not-human"
  /** A line anchor on a line the change set does not have. */
  | "line-not-in-diff"
  /** A scope that does not add up: a repository the root has not, a path outside its repository. */
  | "invalid-scope"
  /** A comment on something the review task is not about ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)). */
  | "out-of-scope"
  /** Narrowing the scope would take comments with it, and nothing consented to that. */
  | "scope-has-comments"
  /** `reply --confirm-severity` on a comment whose severity the model did not choose, or one already confirmed. */
  | "severity-not-auto"
  /** `reply --confirm-severity` with an empty `--author`: the label would name nobody. */
  | "invalid-author";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/** How many comment ids a refusal spells out before it counts the rest. */
const NAMED_IDS = 12;

/**
 * The refusal that narrowing the scope raises while comments are anchored under
 * what it removes (`docs/SPEC.md` section 7). It carries every id, because the
 * caller decides what to do with them, while the message names the count and
 * the first of them: a line with two hundred ids on it answers nobody. The
 * message names the CLI flag, which is the contract this refusal is written
 * for; the API hands the UI `count` and `comments` so it can word its own
 * question ([07-server.md](../../../docs/reference/07-server.md)).
 */
export class ScopeCommentsError extends DomainError {
  /** The comments the narrowing would delete, in the order they were written. */
  readonly comments: string[];

  constructor(comments: string[]) {
    const named = comments.slice(0, NAMED_IDS);
    const rest = comments.length - named.length;
    const ids = rest === 0 ? named.join(", ") : `${named.join(", ")}, and ${rest} more`;
    super(
      "scope-has-comments",
      `${comments.length} ${comments.length === 1 ? "comment is" : "comments are"} ` +
        `anchored under what this removes (${ids}); pass --drop-comments to delete them ` +
        "with the scope",
    );
    this.name = "ScopeCommentsError";
    this.comments = comments;
  }
}
