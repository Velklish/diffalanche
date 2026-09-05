/** The change set of one review, as the server hands it to the UI in one response. */
export type ReviewBundle = {
  /** Absolute path of the root the repositories were found under. */
  root: string;
  repositories: RepositoryChange[];
  totals: ReviewTotals;
  /** Everything the scan had to say: unread directories, worktrees, unresolved bases. */
  warnings: ScanWarning[];
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
  /** The checked-out branch; a detached HEAD gives its abbreviated revision. */
  branch: string;
  /** The base the change set was computed against; `null` when it did not resolve. */
  base: ResolvedBase | null;
  files: FileChange[];
  /** What the base resolution had to say about this repository. */
  warnings: string[];
};

/**
 * How a review session computes its change set (`docs/SPEC.md` section 3,
 * decision 4). One spec per session, resolved separately in every repository.
 */
export type BaseSpec =
  | { mode: "head" }
  | { mode: "branch"; branch?: string | undefined }
  | { mode: "ref"; ref: string };

export type BaseMode = BaseSpec["mode"];

/** The base one repository's change set was actually computed against. */
export type ResolvedBase = {
  /** The mode that produced it, which is not always the mode that was asked for. */
  mode: BaseMode;
  /** The name it came from: `HEAD`, `origin/develop`, a tag. */
  ref: string;
  /** The revision the diff ran against: HEAD, the merge base, or the resolved ref. */
  sha: string;
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
   * included: the renderer parses that header before the hunks
   * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)). Empty for a
   * file listed without content.
   */
  patch: string;
  /** The same diff structured, as `diff.json` stores it. Empty without content. */
  hunks: Hunk[];
  /** Why the file is listed without its content, or `null` when the patch is there. */
  omitted: FileOmission | null;
};

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

/** A binary file has no text diff; a file over the size limit is not carried. */
export type FileOmission = "binary" | "too-large";

/** One hunk of a file's diff: its header and its lines (`docs/SPEC.md` section 7). */
export type Hunk = {
  /** The header exactly as git prints it: `@@ -30,8 +38,12 @@ function f()`. */
  header: string;
  lines: DiffLine[];
};

/** One line of a hunk. A line missing from a side carries `null` for that side. */
export type DiffLine = {
  type: DiffLineType;
  /** The line itself, without the leading ` `, `+`, or `-`. */
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

export type DiffLineType = "context" | "insert" | "delete";

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
