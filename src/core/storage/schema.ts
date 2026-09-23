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
} from "./types.ts";
import {
  COMMENT_STATUSES,
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

/**
 * The version is checked before anything else: a file of a version this build
 * does not know is refused whole rather than read field by field. A version this
 * build still reads is turned into the current one, so what the caller holds is
 * always the current shape and the next write puts the file on it.
 */
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

/**
 * One entry of the scope: a repository, with the paths it is about or without
 * them. An empty list of paths is refused for the same reason an empty scope
 * is — it is an entry that shows nothing, and the way to say "the whole
 * repository" is to leave `paths` out.
 */
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

/**
 * The scope of a review task (`docs/SPEC.md` section 7). Absent or `null` is the
 * whole root, which is what every session written before DA-53 means. An empty
 * array is refused: a task that shows nothing is a mistake, not a state. So is a
 * repository named twice — one repository is one entry, and two entries for it
 * would leave "the whole repository" and "these files" both true of it.
 */
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

/**
 * `review.json`. A file of version 1 carries none of the four fields DA-53
 * added: it is read as a task over the whole root that is still open, which is
 * what such a session has always meant, and the next write puts it on version 2.
 */
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

/**
 * `diff.json` is written only by a scan and overwritten whole on the next one
 * ([ADR-003](../../../docs/adr/adr-003-on-disk-format.md)), so it is checked
 * down to its envelope only: the change set inside it is the git reader's
 * contract, not storage's.
 */
export function parseDiffCache(file: string, text: string): DiffCache | null {
  const raw = asObject(file, null, parseJson(file, text));
  // A cache of a version this build does not know is discarded rather than
  // refused: it is the answer to a scan, and the caller can scan again. The two
  // files that hold what a person wrote are the ones a bad version refuses.
  if (raw.version !== SCHEMA_VERSION) return null;
  // A cache written before `base` and `scope` were recorded cannot say what it
  // was computed for, so it is no answer at all: `null` is "never scanned", and
  // the caller scans. Only this file is treated that way — the tool writes it
  // and rewrites it, and `docs/SPEC.md` section 7 already says hand edits are
  // lost. A `scope` of `null` is the whole root and an answer like any other;
  // what is missing here is the field itself.
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
