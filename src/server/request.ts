/**
 * Reading a request body. The domain checks what a comment means — that a line
 * anchor has a file, that only a human resolves; this checks that what arrived
 * is of the right shape at all, and refuses with the field named.
 */
import type { Context } from "hono";
import type { Severity, Side } from "../core/storage/index.ts";
import { SEVERITIES, SIDES } from "../core/storage/index.ts";
import { RequestError } from "./errors.ts";

export type Body = Record<string, unknown>;

/**
 * The body as an object. A body has to arrive as `application/json`: a form or
 * a `text/plain` post is what a page on another origin can send without the
 * browser asking this server first, and no route here takes one. No body at all
 * is an empty object — `resolve` and `reopen` take a note or nothing.
 */
export async function readBody(c: Context): Promise<Body> {
  const raw = await c.req.text();
  if (raw.trim() === "") return {};
  if (!/^application\/json\b/i.test(c.req.header("content-type") ?? "")) {
    throw new RequestError("a request body has to be sent as application/json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new RequestError("the request body is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RequestError("the request body has to be a JSON object");
  }
  return parsed as Body;
}

/** A field that has to be there and has to say something. */
export function text(body: Body, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new RequestError(`${field} has to be a non-empty string`);
  }
  return value;
}

/** A field that may be missing; missing is `undefined`, not an empty string. */
export function optionalText(body: Body, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new RequestError(`${field} has to be a non-empty string`);
  }
  return value;
}

/**
 * An anchor field that is absent as often as it is present: `repo: null` is the
 * whole review, `path: null` a repository, `line: null` a file, so a field the
 * client left out is `null` rather than a mistake (`docs/SPEC.md` section 7).
 */
export function nullableText(body: Body, field: string): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value === "") {
    throw new RequestError(`${field} has to be a non-empty string or absent`);
  }
  return value;
}

export function nullableLine(body: Body, field: string): number | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RequestError(`${field} has to be a whole line number or absent`);
  }
  return value;
}

export function severity(body: Body): Severity {
  const value = body.severity;
  if (typeof value !== "string" || !SEVERITIES.includes(value as Severity)) {
    throw new RequestError(`severity has to be one of ${SEVERITIES.join(", ")}`);
  }
  return value as Severity;
}

export function side(body: Body): Side | null {
  const value = body.side;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !SIDES.includes(value as Side)) {
    throw new RequestError(`side has to be one of ${SIDES.join(", ")}`);
  }
  return value as Side;
}

/** One of a fixed set, from the query string; absent takes the default. */
export function choice<T extends string>(
  value: string | undefined,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === "") return fallback;
  if (!allowed.includes(value as T)) {
    throw new RequestError(`${field} has to be one of ${allowed.join(", ")}`);
  }
  return value as T;
}
