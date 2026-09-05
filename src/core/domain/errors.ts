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
  | "line-not-in-diff";

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
