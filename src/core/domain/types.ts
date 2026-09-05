/** What the domain hands to the CLI and the API above the on-disk shapes. */
import type { Base } from "../storage/index.ts";

/** One row of the session list: the metadata plus the counters the UI shows. */
export type SessionSummary = {
  name: string;
  title: string | null;
  base: Base;
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
