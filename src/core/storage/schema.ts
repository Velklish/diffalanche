/** Validation of hand-edited files: every refusal names the file and the field, and nothing
 * half-parsed reaches the caller (03-storage.md, "Validation and errors"). */
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
import type {
  Anchor,
  Base,
  Comment,
  CommentsFile,
  DiffCache,
  Reply,
  Review,
  Scope,
  ScopeEntry,
  SeveritySource,
} from "./types.ts";
import {
  COMMENT_STATUSES,
  isSeveritySource,
  READABLE_VERSIONS,
  REVIEW_STATUSES,
  ROLES,
  SCHEMA_VERSION,
  SEVERITIES,
  SIDES,
} from "./types.ts";

/** Serialises a value the way every file of the data directory is written. */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Checked first, refusing an unknown version whole; a readable one becomes the current, so the
 * next write upgrades the file (03-storage.md, "Schema versions"). */
function asVersion(file: string, value: unknown): number {
  if (typeof value !== "number" || !READABLE_VERSIONS.includes(value)) {
    fail(
      file,
      "version",
      `expected one of ${READABLE_VERSIONS.join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
  return SCHEMA_VERSION;
}

function parseBase(file: string, field: string, value: unknown): Base {
  const raw = asObject(file, field, value);
  const mode = asOneOf(file, `${field}.mode`, raw.mode, ["head", "branch", "ref"] as const);
  if (mode === "head") return { mode };
  if (mode === "ref") return { mode, ref: asString(file, `${field}.ref`, raw.ref) };
  const branch = asNullableString(file, `${field}.branch`, raw.branch);
  return branch === null ? { mode } : { mode, branch };
}

/** An empty `paths` is refused as an empty scope is: it shows nothing, and the whole repository
 * is `paths` left out. */
function parseScopeEntry(file: string, field: string, value: unknown): ScopeEntry {
  const raw = asObject(file, field, value);
  const repo = asString(file, `${field}.repo`, raw.repo);
  if (raw.paths === undefined || raw.paths === null) return { repo, paths: null };
  const paths = asStrings(file, `${field}.paths`, raw.paths);
  if (paths.length === 0) {
    fail(
      file,
      `${field}.paths`,
      "an empty list shows nothing; leave it out for the whole repository",
    );
  }
  return { repo, paths };
}

/** Absent or `null` is the whole root; an empty list and a repository named twice are refused
 * (03-storage.md, "Validation and errors"). */
function parseScope(file: string, field: string, value: unknown): Scope {
  if (value === undefined || value === null) return null;
  const entries = asArray(file, field, value);
  if (entries.length === 0) {
    fail(file, field, "an empty scope shows nothing; leave it out for the whole root");
  }
  const scope = entries.map((entry, index) => parseScopeEntry(file, `${field}[${index}]`, entry));
  const seen = new Set<string>();
  for (const [index, entry] of scope.entries()) {
    if (seen.has(entry.repo)) {
      fail(file, `${field}[${index}].repo`, `${entry.repo} is already in the scope`);
    }
    seen.add(entry.repo);
  }
  return scope;
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

/** Absent in a comment written before DA-36, whose severity its writer chose: that reads `manual`. */
function parseSeveritySource(file: string, field: string, value: unknown): SeveritySource {
  if (value === undefined || value === null) return "manual";
  if (isSeveritySource(value)) return value;
  return fail(
    file,
    field,
    `expected auto, manual, or confirmed:<author>, got ${JSON.stringify(value)}`,
  );
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
    severitySource: parseSeveritySource(file, `${field}.severitySource`, raw.severitySource),
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

/** A version 1 file lacks the four fields of DA-53 and reads as an open task over the whole
 * root; the next write puts it on version 2. */
export function parseReview(file: string, text: string): Review {
  const raw = asObject(file, null, parseJson(file, text));
  return {
    version: asVersion(file, raw.version),
    name: asString(file, "name", raw.name),
    title: asNullableString(file, "title", raw.title),
    base: parseBase(file, "base", raw.base),
    scope: parseScope(file, "scope", raw.scope),
    status:
      raw.status === undefined || raw.status === null
        ? "open"
        : asOneOf(file, "status", raw.status, REVIEW_STATUSES),
    closedAt: asNullableString(file, "closedAt", raw.closedAt),
    closedBy: asNullableString(file, "closedBy", raw.closedBy),
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

/** Written only by a scan, so checked to its envelope and its key, `base` and `scope`; the change
 * set inside is the git reader's contract (03-storage.md, "Validation and errors"). */
export function parseDiffCache(file: string, text: string): DiffCache | null {
  const raw = asObject(file, null, parseJson(file, text));
  // Discarded rather than refused: the caller can scan again, and only the two files a person
  // wrote are refused for a bad version (03-storage.md, "Schema versions").
  if (raw.version !== SCHEMA_VERSION) return null;
  // A missing `base` or `scope` field, not a `null` scope, cannot say what it answers: it reads
  // as never scanned (03-storage.md, "Validation and errors").
  if (raw.base === undefined || raw.scope === undefined) return null;
  const base = parseBase(file, "base", raw.base);
  const scope = parseScope(file, "scope", raw.scope);
  asString(file, "root", raw.root);
  asArray(file, "repositories", raw.repositories);
  // Absent in a cache written before it: read as it is, and the patching writers scan instead.
  if (raw.rootWarnings !== undefined) asArray(file, "rootWarnings", raw.rootWarnings);
  asObject(file, "totals", raw.totals);
  return { ...(raw as unknown as DiffCache), base, scope };
}
