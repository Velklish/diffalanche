/**
 * Reading a request body. The domain checks what a comment means — that a line
 * anchor has a file, that only a human resolves; this checks that what arrived
 * is of the right shape at all, and refuses with the field named.
 */
import type { Context } from "hono";
import type { Scope, Severity, Side } from "../core/storage/index.ts";
import { SEVERITIES, SEVERITY_SOURCES, SIDES } from "../core/storage/index.ts";
import { RequestError } from "./errors.ts";

type Body = Record<string, unknown>;

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

/**
 * The `scope` of `PUT /api/sessions/:name/scope`: a list of entries, or `null`
 * for the whole root. What the entries mean is the domain's — a repository the
 * root has not, a path outside its repository — and what arrives here is only
 * checked for being a scope at all.
 */
export function scope(body: Body): Scope {
  const value = body.scope;
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new RequestError("scope has to be a list of entries, or null for the whole root");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new RequestError(`scope[${index}] has to be an object`);
    }
    const one = entry as Body;
    if (typeof one.repo !== "string" || one.repo === "") {
      throw new RequestError(`scope[${index}].repo has to be a non-empty string`);
    }
    if (one.paths === undefined || one.paths === null) return { repo: one.repo, paths: null };
    if (!Array.isArray(one.paths) || one.paths.some((path) => typeof path !== "string")) {
      throw new RequestError(`scope[${index}].paths has to be a list of strings, or absent`);
    }
    return { repo: one.repo, paths: one.paths as string[] };
  });
}

/** A flag that says yes only when it says so; anything else is no. */
export function consent(body: Body, field: string): boolean {
  const value = body[field];
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new RequestError(`${field} has to be true or false`);
  return value;
}

export function severity(body: Body): Severity {
  const value = body.severity;
  if (typeof value !== "string" || !SEVERITIES.includes(value as Severity)) {
    throw new RequestError(`severity has to be one of ${SEVERITIES.join(", ")}`);
  }
  return value as Severity;
}

/** Who chose the severity: absent is the writer; `confirmed:` is a reply's to make, not a write's. */
export function severitySource(body: Body): "auto" | "manual" {
  const value = body.severitySource;
  if (value === undefined || value === null) return "manual";
  if (value !== "auto" && value !== "manual") {
    throw new RequestError(`severitySource has to be one of ${SEVERITY_SOURCES.join(", ")}`);
  }
  return value;
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
