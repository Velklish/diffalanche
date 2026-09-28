/** The on-disk shapes of `docs/SPEC.md` section 7, owned by storage as the only module that reads
 * and writes the files; every other module takes the parsed value. */
import type { BaseSpec, ReviewBundle, ScanWarning } from "../types.ts";

/** The version every file of the data directory is written with. */
export const SCHEMA_VERSION = 2;

/** The `review.json` and `comments.json` versions this build reads; `diff.json`, a cache, is not
 * in the list ([03-storage.md](../../../docs/reference/03-storage.md), "Schema versions"). */
export const READABLE_VERSIONS: readonly number[] = [1, SCHEMA_VERSION];

/** The `base` of `review.json`: the change-set reader's own `BaseSpec`, one name for one thing —
 * storage parses it, git resolves it. */
export type Base = BaseSpec;

export type Severity = "critical" | "warning" | "nit" | "question";
export type CommentStatus = "open" | "resolved";
export type Role = "human" | "agent";
export type Side = "new" | "old";

/** Whether the review task is still being worked on. A human sets both. */
export type ReviewStatus = "open" | "closed";

/** A whole repository, or one with the paths the task is about, in one list and one concept
 * ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)); paths as `comments.json` has them. */
export type ScopeEntry = {
  repo: string;
  /** `null` — the whole repository. */
  paths: string[] | null;
};

/** What a review task is about; `null` is the whole root, the way sessions used to be. */
export type Scope = ScopeEntry[] | null;

/** The one list the schema and the CLI both check against: two lists drift once one gains a
 * word. `SEVERITIES` is worst first (`docs/SPEC.md` section 3, decision 7). */
export const SEVERITIES: readonly Severity[] = ["critical", "warning", "nit", "question"];
export const COMMENT_STATUSES: readonly CommentStatus[] = ["open", "resolved"];
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["open", "closed"];
export const ROLES: readonly Role[] = ["human", "agent"];
export const SIDES: readonly Side[] = ["new", "old"];

/** Who chose a comment's severity: its writer, the model at send time, or the model and then the
 * agent named after `confirmed:` (`docs/SPEC.md` section 7). */
export type SeveritySource = "auto" | "manual" | `confirmed:${string}`;
/** The two a writer sends; `confirmed:<author>` is only ever made from `auto` by a reply. */
export const SEVERITY_SOURCES: readonly ("auto" | "manual")[] = ["auto", "manual"];

const CONFIRMED = "confirmed:";

/** The author who confirmed an automatic severity, or `null` while nobody has. */
export function confirmedBy(source: SeveritySource): string | null {
  return source.startsWith(CONFIRMED) ? source.slice(CONFIRMED.length) : null;
}

/** One test for every reader of the field, so a new source is read the day storage writes it. */
export function isSeveritySource(value: unknown): value is SeveritySource {
  if (typeof value !== "string") return false;
  return (
    (SEVERITY_SOURCES as readonly string[]).includes(value) ||
    !!confirmedBy(value as SeveritySource)
  );
}

/** Where a line comment sits in the change set; the input for Phase 3 re-anchoring. */
export type Anchor = {
  lineContent: string;
  hunk: string;
  before: string[];
  after: string[];
};

export type Reply = {
  id: string;
  author: string;
  role: Role;
  body: string;
  createdAt: string;
};

/** A comment with its thread; the level is read off the nulls of `repo`, `path` and `line`. */
export type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  side: Side | null;
  line: number | null;
  endLine: number | null;
  anchor: Anchor | null;
  severity: Severity;
  severitySource: SeveritySource;
  status: CommentStatus;
  author: string;
  role: Role;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  replies: Reply[];
};

/** `review.json`, its fields in the order `docs/SPEC.md` section 7 shows and a write puts them. */
export type Review = {
  version: number;
  name: string;
  title: string | null;
  base: Base;
  /** What the task is about; `null` is the whole root. */
  scope: Scope;
  status: ReviewStatus;
  /** When and by whom the task was closed; both `null` while it is open. */
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** `comments.json`: the threads of one review session. */
export type CommentsFile = {
  version: number;
  comments: Comment[];
};

/** `diff.json`, the set `diff --json` prints, with the base and scope it was computed for: after
 * either changes, it answers another question (03-storage.md, "Validation and errors"). */
export type DiffCache = {
  version: number;
  base: Base;
  scope: Scope;
  /** The part of `warnings` the walk of the root and the scope said, which a patch puts back; absent
   * in a cache written before it, which is read as it is and never patched (03-storage.md). */
  rootWarnings?: ScanWarning[];
} & ReviewBundle;

/** What `reviews/` holds: the session names, and why a directory was left out. */
export type SessionListing = {
  names: string[];
  warnings: string[];
};
