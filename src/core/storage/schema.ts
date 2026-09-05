/**
 * Validation of the files of the data directory. The files are meant to be
 * edited by hand (`docs/SPEC.md` section 3, decision 5), so a broken one is an
 * ordinary event: every refusal names the file and the field, and nothing
 * half-parsed reaches the caller.
 */
import { StorageError } from "./errors.ts";
import type {
  Anchor,
  Base,
  Comment,
  CommentStatus,
  CommentsFile,
  DiffCache,
  Reply,
  Review,
  Role,
  Severity,
  Side,
} from "./types.ts";
import { SCHEMA_VERSION } from "./types.ts";

const SEVERITIES: readonly Severity[] = ["critical", "warning", "nit", "question"];
const STATUSES: readonly CommentStatus[] = ["open", "resolved"];
const ROLES: readonly Role[] = ["human", "agent"];
const SIDES: readonly Side[] = ["new", "old"];

/** Serialises a value the way every file of the data directory is written. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fail(file: string, field: string | null, message: string): never {
  throw new StorageError(file, field, message);
}

/** Names the type of a value the way a message about a wrong field should. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

function parseJson(file: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(file, null, `not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asObject(file: string, field: string | null, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(file, field, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function asString(file: string, field: string, value: unknown): string {
  if (typeof value !== "string") fail(file, field, `expected a string, got ${describe(value)}`);
  return value;
}

function asNullableString(file: string, field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return asString(file, field, value);
}

function asNullableNumber(file: string, field: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(file, field, `expected an integer, got ${describe(value)}`);
  }
  return value;
}

function asArray(file: string, field: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) fail(file, field, `expected an array, got ${describe(value)}`);
  return value;
}

function asStrings(file: string, field: string, value: unknown): string[] {
  return asArray(file, field, value).map((item, index) =>
    asString(file, `${field}[${index}]`, item),
  );
}

function asOneOf<T extends string>(
  file: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  const text = asString(file, field, value);
  if (!(allowed as readonly string[]).includes(text)) {
    fail(file, field, `expected one of ${allowed.join(", ")}, got ${JSON.stringify(text)}`);
  }
  return text as T;
}

function asNullableOneOf<T extends string>(
  file: string,
  field: string,
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null) return null;
  return asOneOf(file, field, value, allowed);
}

/**
 * The version is checked before anything else: a file of a version this build
 * does not know is refused whole rather than read field by field.
 */
function asVersion(file: string, value: unknown): number {
  if (value !== SCHEMA_VERSION) {
    fail(file, "version", `expected ${SCHEMA_VERSION}, got ${JSON.stringify(value)}`);
  }
  return SCHEMA_VERSION;
}

export function parseBase(file: string, field: string, value: unknown): Base {
  const raw = asObject(file, field, value);
  const mode = asOneOf(file, `${field}.mode`, raw.mode, ["head", "branch", "ref"] as const);
  if (mode === "head") return { mode };
  if (mode === "ref") return { mode, ref: asString(file, `${field}.ref`, raw.ref) };
  const branch = asNullableString(file, `${field}.branch`, raw.branch);
  return branch === null ? { mode } : { mode, branch };
}

function parseAnchor(file: string, field: string, value: unknown): Anchor | null {
  if (value === undefined || value === null) return null;
  const raw = asObject(file, field, value);
  return {
    lineContent: asString(file, `${field}.lineContent`, raw.lineContent),
    hunk: asString(file, `${field}.hunk`, raw.hunk),
    before: asStrings(file, `${field}.before`, raw.before),
    after: asStrings(file, `${field}.after`, raw.after),
  };
}

function parseReply(file: string, field: string, value: unknown): Reply {
  const raw = asObject(file, field, value);
  return {
    id: asString(file, `${field}.id`, raw.id),
    author: asString(file, `${field}.author`, raw.author),
    role: asOneOf(file, `${field}.role`, raw.role, ROLES),
    body: asString(file, `${field}.body`, raw.body),
    createdAt: asString(file, `${field}.createdAt`, raw.createdAt),
  };
}

function parseComment(file: string, field: string, value: unknown): Comment {
  const raw = asObject(file, field, value);
  return {
    id: asString(file, `${field}.id`, raw.id),
    repo: asNullableString(file, `${field}.repo`, raw.repo),
    path: asNullableString(file, `${field}.path`, raw.path),
    side: asNullableOneOf(file, `${field}.side`, raw.side, SIDES),
    line: asNullableNumber(file, `${field}.line`, raw.line),
    endLine: asNullableNumber(file, `${field}.endLine`, raw.endLine),
    anchor: parseAnchor(file, `${field}.anchor`, raw.anchor),
    severity: asOneOf(file, `${field}.severity`, raw.severity, SEVERITIES),
    status: asOneOf(file, `${field}.status`, raw.status, STATUSES),
    author: asString(file, `${field}.author`, raw.author),
    role: asOneOf(file, `${field}.role`, raw.role, ROLES),
    body: asString(file, `${field}.body`, raw.body),
    createdAt: asString(file, `${field}.createdAt`, raw.createdAt),
    resolvedAt: asNullableString(file, `${field}.resolvedAt`, raw.resolvedAt),
    resolvedBy: asNullableString(file, `${field}.resolvedBy`, raw.resolvedBy),
    replies: asArray(file, `${field}.replies`, raw.replies).map((reply, index) =>
      parseReply(file, `${field}.replies[${index}]`, reply),
    ),
  };
}

export function parseReview(file: string, text: string): Review {
  const raw = asObject(file, null, parseJson(file, text));
  return {
    version: asVersion(file, raw.version),
    name: asString(file, "name", raw.name),
    title: asNullableString(file, "title", raw.title),
    base: parseBase(file, "base", raw.base),
    createdAt: asString(file, "createdAt", raw.createdAt),
    updatedAt: asString(file, "updatedAt", raw.updatedAt),
  };
}

export function parseComments(file: string, text: string): CommentsFile {
  const raw = asObject(file, null, parseJson(file, text));
  return {
    version: asVersion(file, raw.version),
    comments: asArray(file, "comments", raw.comments).map((comment, index) =>
      parseComment(file, `comments[${index}]`, comment),
    ),
  };
}

/**
 * `diff.json` is written only by a scan and overwritten whole on the next one
 * ([ADR-003](../../../docs/adr/adr-003-on-disk-format.md)), so it is checked
 * down to its envelope only: the change set inside it is the git reader's
 * contract, not storage's.
 */
export function parseDiffCache(file: string, text: string): DiffCache {
  const raw = asObject(file, null, parseJson(file, text));
  asVersion(file, raw.version);
  asString(file, "root", raw.root);
  asArray(file, "repositories", raw.repositories);
  asObject(file, "totals", raw.totals);
  return raw as unknown as DiffCache;
}
