/** The shapes the UI shares with the tool, in one import: `src/core`'s own, which must stay pure as
 * the UI compiles with `"types": []` (08-ui.md, "Types of the on-disk format"). */

export type {
  Counters,
  ReviewCounters,
} from "../core/domain/counters.ts";
export type {
  Base,
  Comment,
  CommentStatus,
  Reply,
  Review,
  ReviewStatus,
  Scope,
  Severity,
  Side,
} from "../core/storage/types.ts";
/** Worst first (`docs/SPEC.md` section 3, decision 7): the order of the composer's chips. */
export { confirmedBy, SEVERITIES } from "../core/storage/types.ts";

import type { Base, ReviewStatus, Scope, Severity, SeveritySource } from "../core/storage/types.ts";
import type { FileStatus, ScanWarning } from "../core/types.ts";

export type {
  BaseMode,
  FileChange,
  FileContent,
  FileRevision,
  RepositoryChange,
  RepositoryTree,
  ReviewDocument,
  ScanWarning,
  SymbolHit,
  SymbolSearch,
  TextHit,
  TextSearch,
} from "../core/types.ts";
export type { ActivityEvent } from "../core/watcher/activity.ts";

/** `GET /api/repos/branches` (DA-24, 07-server.md), written again: its owner, the server's
 * `routes/branches.ts`, reaches git; `tests/ui-wire.test.ts` holds the two shapes together. */
export type BranchCandidate = {
  /** `origin/main` for a branch of a remote, `main` for a local one. */
  name: string;
  /** The remote it belongs to, or `null` when the branch is local. */
  remote: string | null;
  /** In how many repositories of the root this branch resolves. */
  repositories: number;
  /** Whether some repository's remote points its `HEAD` at it. */
  default: boolean;
};

export type BranchList = {
  root: string;
  branches: BranchCandidate[];
  warnings: ScanWarning[];
};

/** One row of `GET /api/sessions` (DA-24), written again: the domain's `SessionSummary` reaches the
 * Node API through the storage barrel; `tests/ui-wire.test.ts` holds the two together. */
export type SessionSummary = {
  name: string;
  title: string | null;
  base: Base;
  /** What the task is about; `null` is the whole root. */
  scope: Scope;
  /** Whether the task is still open, or a human has closed it. */
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  /** Whether `current` names this session. */
  current: boolean;
  open: number;
  resolved: number;
  /** Repositories with changes in the last scan; `null` when it has never been scanned. */
  repositories: number | null;
};

export type SessionList = {
  sessions: SessionSummary[];
  /** Directories under `reviews/` that are not review sessions. */
  warnings: string[];
};

/** `GET /api/sessions/candidates` (DA-55, 07-server.md): the whole root's names, not its diffs.
 * Written again, as `src/server/review.ts` reaches git; `tests/ui-wire.test.ts` pairs the two. */
export type CandidateFile = {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
};

export type CandidateRepository = {
  path: string;
  branch: string;
  files: CandidateFile[];
};

export type CandidateSet = {
  root: string;
  repositories: CandidateRepository[];
  warnings: ScanWarning[];
};

/** `GET /api/suggest`'s answer, written again because the server's reaches the model; the two
 * are held together by `tests/ui-wire.test.ts` ([08-ui.md](../../docs/reference/08-ui.md)). */
export type Suggestion = {
  session: string;
  id: string;
  severity: Severity;
  severitySource: SeveritySource;
  repo: string | null;
  path: string | null;
  line: number | null;
  body: string;
  similarity: number;
};

export type SuggestAnswer = {
  severity: { severity: Severity; confidence: number } | null;
  suggestions: Suggestion[];
};
