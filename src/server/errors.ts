/** How a refusal reaches the browser: the domain's code becomes a status and its message passes
 * untouched, so the UI never words a refusal twice (07-server.md, "Refusals"). */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { DomainErrorCode } from "../core/domain/index.ts";
import { DomainError, ScopeCommentsError } from "../core/domain/index.ts";
import { ModelError } from "../core/ml/embed/errors.ts";
import { NoSuchSessionError, StorageError } from "../core/storage/index.ts";

/** The body of every refusal: the code to branch on, the message to show. */
export type ErrorBody = { error: string; message: string };

/** The 409 of a scope edit that would drop comments: the count and ids ride beside the message
 * so the scope editor words its own question (07-server.md, "Refusals"). */
type ScopeConflictBody = ErrorBody & { count: number; comments: string[] };

/** A request that may not write here at all — one a page on another origin sent — or, from the
 * host check, not even read (07-server.md, "Which host it answers for", "Who may write"). */
export class ForbiddenError extends Error {
  readonly code = "forbidden";

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** A request the domain never gets to see — a body not an object, a severity not one, a field
 * missing: the domain checks what a comment is, this that it is a comment at all. */
export class RequestError extends Error {
  readonly code = "invalid-request";

  constructor(message: string) {
    super(message);
    this.name = "RequestError";
  }
}

/** The codes that mean "there is nothing here" rather than "that request is wrong"; the
 * first-run screen reads the 404 of no current session and offers to create one. */
const NOT_FOUND: ReadonlySet<DomainErrorCode> = new Set<DomainErrorCode>([
  "no-current-session",
  "no-such-session",
  "no-such-comment",
]);

function statusOf(error: DomainError): 400 | 404 {
  return NOT_FOUND.has(error.code) ? 404 : 400;
}

/** A refusal as its status and body; a data-directory file that cannot be read is not the
 * caller's mistake, so it is a 500 with the file and the field the storage named. */
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
  // Neither "nothing here" nor "that request is wrong": well formed, the state says no, and it
  // needs a decision — a 409 with the comments it would take.
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
  // A session deleted while this request was on its way: the answer a missing one gets.
  if (error instanceof NoSuchSessionError) {
    return c.json<ErrorBody>({ error: "no-such-session", message: error.message }, 404);
  }
  if (error instanceof StorageError) {
    return c.json<ErrorBody>({ error: "storage", message: error.message }, 500);
  }
  // The model is not there, or not on this platform: the server works, this part of it does not.
  if (error instanceof ModelError) {
    return c.json<ErrorBody>({ error: "model", message: error.message }, 503);
  }
  return c.json<ErrorBody>({ error: "internal", message: error.message }, 500);
}
