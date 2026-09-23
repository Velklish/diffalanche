/**
 * The shapes the UI shares with the rest of the tool, in one import for the
 * components: the on-disk format of `docs/SPEC.md` section 7, the change set,
 * and the counters the domain computes. They are `src/core`'s own types — the
 * UI mirrored them while the domain was being written and now reads the
 * originals, so the two can no longer drift.
 *
 * `src/core/types.ts` and everything it imports has to stay a leaf of pure
 * types and pure functions: `src/ui/tsconfig.json` compiles the UI with
 * `"types": []` and type-checks that graph through these imports, so nothing in
 * it may reach the Node API ([07-server.md](../../docs/reference/07-server.md)).
 */

export type {
  Counters,
  FileCounters,
  RepositoryCounters,
  ReviewCounters,
} from "../core/domain/counters.ts";
export type {
  Anchor,
  Base,
  Comment,
  CommentStatus,
  Reply,
  Review,
  ReviewStatus,
  Role,
  Scope,
  ScopeEntry,
  Severity,
  Side,
} from "../core/storage/types.ts";
/** Worst first (`docs/SPEC.md` section 3, decision 7): the order of the composer's chips. */
export { SEVERITIES } from "../core/storage/types.ts";

import type { Base, ReviewStatus, Scope } from "../core/storage/types.ts";
import type { FileStatus, ScanWarning } from "../core/types.ts";

export type {
  BaseMode,
  FileChange,
  FileContent,
  FileOmission,
  FileRevision,
  FileStatus,
  RepositoryChange,
  RepositoryTree,
  ResolvedBase,
  ReviewBundle,
  ReviewDocument,
  ScanWarning,
  TextHit,
  TextSearch,
  TreeEntry,
} from "../core/types.ts";
export type { ActivityEvent, ActivityVerb } from "../core/watcher/activity.ts";

/**
 * What `GET /api/repos/branches` answers with (DA-24): every branch of the
 * root, with the remote it belongs to, how many repositories carry it, and
 * whether a remote points its `HEAD` at it
 * ([07-server.md](../../docs/reference/07-server.md)).
 *
 * The server owns the shape, in `src/server/routes/branches.ts`, and this is
 * the same shape written again rather than imported: that module reaches the
 * Node API through git, and the UI compiles with `"types": []`. What keeps the
 * two from drifting is `tests/ui-wire.test.ts`, which is checked with both of
 * them in scope.
 */
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

/**
 * One row of `GET /api/sessions` (DA-24): the metadata of a review session with
 * the counters the menu of handoff section 7 shows.
 *
 * Written again here for the same reason as `BranchCandidate` below: the
 * domain's own `SessionSummary` lives in a module that reaches the storage
 * barrel, and the barrel reaches the Node API, which the UI compiles without.
 * `tests/ui-wire.test.ts` is what keeps the two the same type.
 */
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

/**
 * What `GET /api/sessions/candidates` answers with (DA-55): the change set of
 * the whole root, whatever the task is about, which is what the scope editor
 * offers to pick from. It carries names and not diffs — a picker shows paths,
 * and the patch of a whole root is megabytes
 * ([07-server.md](../../docs/reference/07-server.md)).
 *
 * Written again here for the reason the two shapes above are: the server owns
 * it in `src/server/review.ts`, that module reaches git, and the UI compiles
 * with `"types": []`. `tests/ui-wire.test.ts` is what keeps them the same type.
 */
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
