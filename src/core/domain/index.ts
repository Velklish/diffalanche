export { captureAnchor } from "./anchors.ts";
export type {
  CommentFilter,
  FileSource,
  Reopening,
  Verdict,
} from "./comments.ts";
export { addComment, assertAnchorLevels, get, list, reopen, reply, resolve } from "./comments.ts";

export {
  countReview,
  isAwaiting,
  isOpen,
  isUnanswered,
  worstSeverity,
} from "./counters.ts";
export type { DomainErrorCode } from "./errors.ts";
export { DomainError, ScopeCommentsError } from "./errors.ts";
export { anchorLabel, exportMarkdown } from "./export.ts";
export type { AnchorSources, BlameSource, Reanchored, RepositoryMove } from "./reanchor.ts";
export {
  anchorWarnings,
  reanchorRepositories,
  reanchorRepository,
  withAnchorWarnings,
} from "./reanchor.ts";

export type { ScopeChange } from "./scope.ts";
export {
  assertAnchorInScope,
  assertScope,
  closeSession,
  formatScope,
  isEmptyChange,
  narrowScope,
  pathInScope,
  reopenSession,
  repositoryInScope,
  scopeEntry,
  setScope,
  widenScope,
} from "./scope.ts";

export {
  assertDeletable,
  createSession,
  deleteSession,
  formatBase,
  listSessions,
  parseBaseArgument,
  readSession,
  resolveSessionName,
  setBase,
  useSession,
} from "./sessions.ts";
