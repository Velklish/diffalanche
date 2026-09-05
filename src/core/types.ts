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

/** What a scan is told to look at, from `config.json` (`docs/SPEC.md` section 7). */
export type ScanConfig = {
  /** Directories to walk, relative to the root. */
  roots: string[];
  /** How many levels below a `roots` entry a repository may sit. */
  depth: number;
  /** Globs of directories the walk does not enter. */
  exclude: string[];
};

/** A git working tree found under the root. Sibling worktrees count as repositories. */
export type Repository = {
  /** Path relative to the root, with forward slashes: `repos/group/service-api`. */
  path: string;
  absolutePath: string;
  kind: RepositoryKind;
};

/** `worktree` is a linked worktree, whose `.git` is a file; `repo` is everything else. */
export type RepositoryKind = "repo" | "worktree";

/** A message a scan produces about one repository or one directory it walked. */
export type ScanWarning = {
  /** Path relative to the root of the repository or directory the warning is about. */
  path: string;
  message: string;
};

export type ScanResult = {
  repositories: Repository[];
  warnings: ScanWarning[];
};
