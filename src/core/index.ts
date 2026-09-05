export type { BaseResolution } from "./git/index.ts";
export {
  DEFAULT_MAX_FILE_BYTES,
  parseDiff,
  readRepositoryChange,
  resolveBase,
} from "./git/index.ts";
export { scan } from "./scanner/index.ts";
export type {
  BaseMode,
  BaseSpec,
  DiffLine,
  DiffLineType,
  FileChange,
  FileOmission,
  FileStatus,
  Hunk,
  Repository,
  RepositoryChange,
  RepositoryKind,
  ResolvedBase,
  ReviewBundle,
  ReviewTotals,
  ScanConfig,
  ScanResult,
  ScanWarning,
} from "./types.ts";
