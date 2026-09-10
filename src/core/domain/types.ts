/** What the domain hands to the CLI and the API above the on-disk shapes. */
import type { Base, ReviewStatus, Scope } from "../storage/types.ts";

/** One row of the session list: the metadata plus the counters the UI shows. */
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
  /** Comments of the session by status. */
  open: number;
  resolved: number;
  /**
   * Repositories with changes in the last scan, from `diff.json`; `null` when
   * the session has never been scanned and there is no cache to count.
   */
  repositories: number | null;
};

export type SessionList = {
  sessions: SessionSummary[];
  /** Directories under `reviews/` that are not review sessions. */
  warnings: string[];
};
