/**
 * How a refusal reaches the browser. The domain has one error type with a code
 * ([ADR-004](../../docs/adr/adr-004-agent-contract.md)); the API turns the code
 * into a status and passes the message through untouched, so the UI never has
 * to word a refusal the domain has already worded.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { DomainErrorCode } from "../core/domain/index.ts";
import { DomainError, ScopeCommentsError } from "../core/domain/index.ts";
import { StorageError } from "../core/storage/index.ts";

/** The body of every refusal: the code to branch on, the message to show. */
export type ErrorBody = { error: string; message: string };

/**
 * The refusal a scope edit gets while comments are anchored under what it
 * removes. It carries the count and the ids on top of the message, so the
 * editor of DA-55 can word its own question — "delete 3 comments?" — instead of
 * showing a message written for the CLI
 * ([04-domain.md](../../docs/reference/04-domain.md)).
 */
export type ScopeConflictBody = ErrorBody & { count: number; comments: string[] };

/**
 * A request the domain never gets to see: a body that is not an object, a
 * severity that is not one, a missing field. The domain checks what a comment
 * is; this checks that what arrived is a comment at all.
 */
/**
 * A request that may not write here at all: one a page on another origin sent.
 * The server serves one person on `127.0.0.1` and has no authentication
 * (`docs/SPEC.md` section 11), so the origin of a write is the whole check.
 */
/**
 * A request that may not write here at all: one a page on another origin sent.
 * The server serves one person on `127.0.0.1` and has no authentication
 * (`docs/SPEC.md` section 11), so the origin of a write is the whole check.
 */
export class ForbiddenError extends Error {
  readonly code = "forbidden";

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class RequestError extends Error {
  readonly code = "invalid-request";

  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

/**
 * The codes that mean "there is nothing here" rather than "that request is
 * wrong". A review that has no current session is one of them: the first-run
 * screen reads that 404 and offers to create a session.
 */
const NOT_FOUND: ReadonlySet<DomainErrorCode> = new Set<DomainErrorCode>([
  "no-current-session",
  "no-such-session",
  "no-such-comment",
]);

export function statusOf(error: DomainError): 400 | 404 {
  return NOT_FOUND.has(error.code) ? 404 : 400;
}

/**
 * A file of the data directory that cannot be read is not the caller's mistake,
 * so it is a 500 with the file and the field the storage named.
 */
export function errorResponse(error: Error, c: Context): Response {
  if (error instanceof ForbiddenError) {
    return c.json<ErrorBody>({ error: error.code, message: error.message }, 403);
  }
  // What `csrf()` throws when a form-shaped write arrives from another page.
  if (error instanceof HTTPException) {
    return c.json<ErrorBody>(
      { error: error.status === 403 ? "forbidden" : "invalid-request", message: error.message },
      error.status,
    );
  }
  if (error instanceof RequestError) {
    return c.json<ErrorBody>({ error: error.code, message: error.message }, 400);
  }
  // The one refusal that is neither "there is nothing here" nor "that request
  // is wrong": the request is well formed and the state says no, and what it
  // needs is a decision — a 409 with the comments it would take.
  if (error instanceof ScopeCommentsError) {
    return c.json<ScopeConflictBody>(
      {
        error: error.code,
        message: error.message,
        count: error.comments.length,
        comments: error.comments,
      },
      409,
    );
  }
  if (error instanceof DomainError) {
    return c.json<ErrorBody>({ error: error.code, message: error.message }, statusOf(error));
  }
  if (error instanceof StorageError) {
    return c.json<ErrorBody>({ error: "storage", message: error.message }, 500);
  }
  return c.json<ErrorBody>({ error: "internal", message: error.message }, 500);
}
