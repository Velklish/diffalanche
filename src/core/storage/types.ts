/**
 * The on-disk shapes of `docs/SPEC.md` section 7. Storage owns them because it
 * is the only module that reads and writes these files; every other module
 * takes the parsed value and never touches the JSON.
 */
import type { BaseSpec, ReviewBundle } from "../types.ts";

/** The version every file of the data directory is written with. */
export const SCHEMA_VERSION = 2;

/**
 * The versions of `review.json` and `comments.json` this build reads. A file of
 * version 1 predates the scope of a review task (DA-53): it is read as a task
 * over the whole root that is still open, and written back as version 2 the
 * next time anything writes it. `diff.json` is not in this list — it is a cache,
 * and one of a version this build does not know is discarded and scanned again.
 */
export const READABLE_VERSIONS: readonly number[] = [1, SCHEMA_VERSION];

export type { BaseMode } from "../types.ts";

/**
 * The base of a review session, as `review.json` stores it under `base`: the
 * change-set reader's own `BaseSpec` (`docs/SPEC.md` section 3, decision 4).
 * One name for one thing — storage parses it, git resolves it.
 */
export type Base = BaseSpec;

export type Severity = "critical" | "warning" | "nit" | "question";
export type CommentStatus = "open" | "resolved";
export type Role = "human" | "agent";
export type Side = "new" | "old";

/** Whether the review task is still being worked on. A human sets both. */
export type ReviewStatus = "open" | "closed";

/**
 * One entry of a scope: a whole repository, or a repository with the paths the
 * task is about. Both kinds are one list, so "the diff of these repositories"
 * and "the diff of these files" are one concept
 * ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)). A path is
 * relative to the repository, exactly as `comments.json` writes it.
 */
export type ScopeEntry = {
  repo: string;
  /** `null` — the whole repository. */
  paths: string[] | null;
};

/** What a review task is about; `null` is the whole root, the way sessions used to be. */
export type Scope = ScopeEntry[] | null;

/**
 * The values themselves, in the order they are written about: the schema checks
 * a file against them and the CLI checks a flag against them, and two lists of
 * the same four words drift the moment one of them gains a fifth.
 * `SEVERITIES` is worst first (`docs/SPEC.md` section 3, decision 7).
 */
export const SEVERITIES: readonly Severity[] = ["critical", "warning", "nit", "question"];
export const COMMENT_STATUSES: readonly CommentStatus[] = ["open", "resolved"];
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["open", "closed"];
export const ROLES: readonly Role[] = ["human", "agent"];
export const SIDES: readonly Side[] = ["new", "old"];

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

/**
 * A comment with its thread. The anchor level is read from the nulls: `repo`
 * null is the whole review, `path` null a repository, `line` null a file.
 */
export type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  side: Side | null;
  line: number | null;
  endLine: number | null;
  anchor: Anchor | null;
  severity: Severity;
  status: CommentStatus;
  author: string;
  role: Role;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  replies: Reply[];
};

/**
 * `review.json`: the metadata of one review session. The fields are written in
 * this order, which is the order `docs/SPEC.md` section 7 shows them in.
 */
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

/**
 * `diff.json`: the change set of the last scan, the set `diff --json` prints.
 * It records the base **and the scope** it was computed with, because a session
 * whose base or scope has changed since has a cache that answers a different
 * question than the one now being asked.
 */
export type DiffCache = { version: number; base: Base; scope: Scope } & ReviewBundle;

/** What `reviews/` holds: the session names, and why a directory was left out. */
export type SessionListing = {
  names: string[];
  warnings: string[];
};
