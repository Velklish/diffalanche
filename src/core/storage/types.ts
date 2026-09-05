/**
 * The on-disk shapes of `docs/SPEC.md` section 7. Storage owns them because it
 * is the only module that reads and writes these files; every other module
 * takes the parsed value and never touches the JSON.
 */
import type { BaseSpec, ReviewBundle } from "../types.ts";

/** The version every file of the data directory carries. Migrations are a task of their own. */
export const SCHEMA_VERSION = 1;

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

/**
 * The values themselves, in the order they are written about: the schema checks
 * a file against them and the CLI checks a flag against them, and two lists of
 * the same four words drift the moment one of them gains a fifth.
 * `SEVERITIES` is worst first (`docs/SPEC.md` section 3, decision 7).
 */
export const SEVERITIES: readonly Severity[] = ["critical", "warning", "nit", "question"];
export const COMMENT_STATUSES: readonly CommentStatus[] = ["open", "resolved"];
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

/** `review.json`: the metadata of one review session. */
export type Review = {
  version: number;
  name: string;
  title: string | null;
  base: Base;
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
 * It records the base it was computed with, because a session whose base has
 * changed since has a cache that answers a different question than the one now
 * being asked.
 */
export type DiffCache = { version: number; base: Base } & ReviewBundle;

/** What `reviews/` holds: the session names, and why a directory was left out. */
export type SessionListing = {
  names: string[];
  warnings: string[];
};
