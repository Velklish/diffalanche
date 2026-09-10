export { captureAnchor } from "./anchors.ts";
export type {
  CommentFilter,
  Message,
  NewComment,
  Verdict,
} from "./comments.ts";
export { addComment, get, list, reopen, reply, resolve } from "./comments.ts";
export type {
  Counters,
  FileCounters,
  RepositoryCounters,
  ReviewCounters,
} from "./counters.ts";
export {
  countComments,
  countReview,
  isAwaiting,
  isUnanswered,
  lastMessageRole,
  worstSeverity,
} from "./counters.ts";
export type { DomainErrorCode } from "./errors.ts";
export { DomainError, ScopeCommentsError } from "./errors.ts";
export { anchorLabel, exportMarkdown } from "./export.ts";
export type { Actor } from "./roles.ts";
export { assertHuman } from "./roles.ts";
export type { ScopeChange, ScopeUpdate, SetScopeOptions } from "./scope.ts";
export {
  assertAnchorInScope,
  assertScope,
  closeSession,
  commentInScope,
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
export type { CreateSessionOptions } from "./sessions.ts";
export {
  assertSessionName,
  createSession,
  formatBase,
  listSessions,
  parseBaseArgument,
  readSession,
  resolveSessionName,
  setBase,
  useSession,
} from "./sessions.ts";
export type { SessionList, SessionSummary } from "./types.ts";
