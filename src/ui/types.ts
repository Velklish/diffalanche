/**
 * The on-disk shapes of `docs/SPEC.md` section 7 as the UI receives them, field
 * for field. They live here until the domain of DA-10 lands them in `src/core`;
 * DA-24 and DA-25 then switch the imports, which is why the names match the
 * specification rather than anything the UI would have called them.
 */
import type { ReviewBundle as ChangeSet } from "../core/types.ts";

export type { ScanWarning } from "../core/types.ts";

export type BaseMode = "head" | "branch" | "ref";

/** `base` of `review.json`: `branch` is set in `branch` mode, `ref` in `ref` mode. */
export type Base = {
  mode: BaseMode;
  branch?: string;
  ref?: string;
};

/** `review.json`: the metadata of one review session. */
export type ReviewSession = {
  version: number;
  name: string;
  title: string;
  base: Base;
  createdAt: string;
  updatedAt: string;
};

export type Severity = "critical" | "warning" | "nit" | "question";

/** `orphaned` is Phase 3; the UI carries it because the file format does. */
export type CommentStatus = "open" | "resolved" | "orphaned";

export type Role = "human" | "agent";

export type Side = "new" | "old";

/** The context a line anchor keeps so Phase 3 can find the line again. */
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
 * One thread. The anchor level is read from the nulls: `repo: null` is the whole
 * review, `path: null` a repository, `line: null` a file; `endLine` widens a
 * line anchor into a range.
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
 * The header's two numbers plus the resolved count. `open` is every comment that
 * is not resolved; `awaiting` is the part of those whose last message is from an
 * agent, so the human has not verified it yet (`docs/GLOSSARY.md`).
 */
export type ReviewCounters = {
  open: number;
  awaiting: number;
  resolved: number;
};

/** What `GET /api/review` returns: the change set plus the current session. */
export type ReviewBundle = ChangeSet & {
  session: ReviewSession | null;
  comments: Comment[];
};

/** Worst first: the colour of a repository's counter is the worst of its comments. */
export const SEVERITY_ORDER: Severity[] = ["critical", "warning", "nit", "question"];
