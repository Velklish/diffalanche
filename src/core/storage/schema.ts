/**
 * Validation of the files of the data directory. The files are meant to be
 * edited by hand (`docs/SPEC.md` section 3, decision 5), so a broken one is an
 * ordinary event: every refusal names the file and the field, and nothing
 * half-parsed reaches the caller.
 */
import {
  asArray,
  asNullableNumber,
  asNullableOneOf,
  asNullableString,
  asObject,
  asOneOf,
  asString,
  asStrings,
  fail,
  parseJson,
} from "./fields.ts";
import type { Anchor, Base, Comment, CommentsFile, DiffCache, Reply, Review } from "./types.ts";
import { COMMENT_STATUSES, ROLES, SCHEMA_VERSION, SEVERITIES, SIDES } from "./types.ts";

/** Serialises a value the way every file of the data directory is written. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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
    status: asOneOf(file, `${field}.status`, raw.status, COMMENT_STATUSES),
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
export function parseDiffCache(file: string, text: string): DiffCache | null {
  const raw = asObject(file, null, parseJson(file, text));
  asVersion(file, raw.version);
  // A cache written before `base` was recorded cannot say what it was computed
  // against, so it is no answer at all: `null` is "never scanned", and the
  // caller scans. Only this file is treated that way — the tool writes it and
  // rewrites it, and `docs/SPEC.md` section 7 already says hand edits are lost.
  if (raw.base === undefined) return null;
  const base = parseBase(file, "base", raw.base);
  asString(file, "root", raw.root);
  asArray(file, "repositories", raw.repositories);
  asObject(file, "totals", raw.totals);
  return { ...(raw as unknown as DiffCache), base };
}
