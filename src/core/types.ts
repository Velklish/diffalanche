/** The change set of one review, as the server hands it to the UI in one response. */
export type ReviewBundle = {
  /** Absolute path of the root the repositories were found under. */
  root: string;
  repositories: RepositoryChange[];
  totals: ReviewTotals;
};

export type ReviewTotals = {
  repositories: number;
  files: number;
  /** Insertions plus deletions over every file, as `git diff --numstat` counts them. */
  lines: number;
};

/** One repository with changes, identified by its path relative to the root. */
export type RepositoryChange = {
  path: string;
  branch: string;
  /** The base the change set was computed against; `HEAD` in `head` mode. */
  base: string;
  files: FileChange[];
};

export type FileChange = {
  /** Path inside the repository; the new path for a rename. */
  path: string;
  /** The old path when the file was renamed, otherwise `null`. */
  oldPath: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  /**
   * The file's unified diff exactly as git prints it, `diff --git` header
   * included: both candidate diff libraries parse that header before the hunks.
   */
  patch: string;
};

export type FileStatus = "added" | "modified" | "deleted" | "renamed";
