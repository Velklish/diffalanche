import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { byCodePoint } from "../order.ts";
import type { BaseSpec, FileChange, RepositoryChange, ResolvedBase } from "../types.ts";
import { GitError } from "./errors.ts";
import { DEFAULT_MAX_FILE_BYTES, type PatchOptions, parseDiff, quotePath } from "./patch.ts";
import {
  currentBranch,
  defaultRemote,
  diff,
  mergeBase,
  remoteDefaultBranch,
  repositoryDrivers,
  revParse,
  untrackedFiles,
} from "./run.ts";

export type { PatchOptions } from "./patch.ts";
export { DEFAULT_MAX_FILE_BYTES, parseDiff } from "./patch.ts";
export { checkIgnore } from "./run.ts";

/** What a base resolution came to in one repository. */
export type BaseResolution = {
  /** `null` when the base did not resolve and the repository is out of the review. */
  base: ResolvedBase | null;
  warnings: string[];
};

/**
 * Resolves the session's base in one repository (`docs/SPEC.md` section 3,
 * decision 4). Every fallback is a warning, so the reason a repository is
 * measured against something other than what was asked for is never silent.
 */
export async function resolveBase(cwd: string, spec: BaseSpec): Promise<BaseResolution> {
  if (spec.mode === "ref") {
    const sha = await revParse(cwd, spec.ref);
    if (!sha) return { base: null, warnings: [`ref ${spec.ref} does not resolve`] };
    return { base: { mode: "ref", ref: spec.ref, sha }, warnings: [] };
  }
  if (spec.mode === "head") return head(cwd, []);
  return branch(cwd, spec.branch);
}

/** `head`: the working tree against HEAD, and the base of every fallback. */
async function head(cwd: string, warnings: string[]): Promise<BaseResolution> {
  const sha = await revParse(cwd, "HEAD");
  if (!sha) return { base: null, warnings: [...warnings, "HEAD does not resolve: no commits yet"] };
  return { base: { mode: "head", ref: "HEAD", sha }, warnings };
}

/**
 * `branch`: the working tree against the merge base of HEAD and a branch — the
 * one the session names, or the remote default branch. A repository that cannot
 * follow that falls back, one step at a time, to `head`.
 */
async function branch(cwd: string, named: string | undefined): Promise<BaseResolution> {
  const warnings: string[] = [];
  let target = named;
  if (target && !(await revParse(cwd, target))) {
    warnings.push(`branch ${target} does not resolve, using the remote default branch`);
    target = undefined;
  }
  if (!target) {
    const remote = await defaultRemote(cwd);
    if (!remote) {
      warnings.push("no remote, reading the working tree against HEAD");
      return head(cwd, warnings);
    }
    const fallback = await remoteDefaultBranch(cwd, remote);
    if (!fallback || !(await revParse(cwd, fallback))) {
      warnings.push(
        `${remote} has no default branch recorded, reading the working tree against HEAD`,
      );
      return head(cwd, warnings);
    }
    target = fallback;
  }
  const sha = await mergeBase(cwd, "HEAD", target);
  if (!sha) {
    warnings.push(`no merge base of HEAD and ${target}, reading the working tree against HEAD`);
    return head(cwd, warnings);
  }
  return { base: { mode: "branch", ref: target, sha }, warnings };
}

/** One repository's change set: the working tree against the resolved base, untracked files
 * included. A base that did not resolve, and a fault of the repository's own, are warnings. */
export async function readRepositoryChange(
  root: string,
  repoPath: string,
  spec: BaseSpec = { mode: "head" },
  options: PatchOptions = {},
): Promise<RepositoryChange> {
  try {
    return await readOne(root, repoPath, spec, options);
  } catch (error) {
    // One repository git refuses is one line of the review, the way an unreadable
    // directory is one line of the scan; a machine that cannot run git is not.
    if (error instanceof GitError && error.repositoryFault) {
      const branch = await currentBranch(join(root, repoPath)).catch(() => "HEAD");
      return { path: repoPath, branch, base: null, files: [], warnings: [error.message] };
    }
    throw error;
  }
}

async function readOne(
  root: string,
  repoPath: string,
  spec: BaseSpec,
  options: PatchOptions,
): Promise<RepositoryChange> {
  const cwd = join(root, repoPath);
  // The drivers are read beside the base rather than before the diff: a third
  // process in a group of three costs the read nothing in wall-clock time.
  const [branchName, resolution, drivers] = await Promise.all([
    currentBranch(cwd),
    resolveBase(cwd, spec),
    repositoryDrivers(cwd),
  ]);
  // A repository whose configuration could not be read is read no further: the
  // pins that keep its own configuration inert are built from that answer.
  if (drivers === null) {
    const refused = [...resolution.warnings, "repository configuration could not be read"];
    return { path: repoPath, branch: branchName, base: null, files: [], warnings: refused };
  }
  if (!resolution.base) {
    return {
      path: repoPath,
      branch: branchName,
      base: null,
      files: [],
      warnings: resolution.warnings,
    };
  }
  const [raw, untracked] = await Promise.all([
    diff(cwd, resolution.base.sha, drivers),
    untrackedFiles(cwd),
  ]);
  const { files, notes } = parseDiff(raw, options);
  const warnings = [...resolution.warnings, ...notes];
  const tracked = new Set(files.map((file) => file.path));
  for (const path of untracked) {
    // `git rm --cached` leaves both sources naming it: the diff has the deletion
    // the index made, `ls-files` has the file still on disk (DA-76).
    if (tracked.has(path)) {
      warnings.push(
        `${path} is deleted from the base and still on disk: it was untracked out of it`,
      );
      continue;
    }
    const one = await readUntracked(cwd, path, options);
    if ("file" in one) files.push(one.file);
    else warnings.push(one.warning);
  }
  files.sort((a, b) => byCodePoint(a.path, b.path));
  return { path: repoPath, branch: branchName, base: resolution.base, files, warnings };
}

/** `ls-files --others` names entries, and an entry the reader cannot make a file of costs a
 * warning and its own line of the change set, never the whole review. */
type UntrackedRead = { file: FileChange } | { warning: string };

/** An untracked file is an addition. A path the diff already carries is not read again: the caller
 * drops it, because `git rm --cached` leaves both sources naming it (DA-76). */
async function readUntracked(
  cwd: string,
  path: string,
  options: PatchOptions,
): Promise<UntrackedRead> {
  const listed = (omitted: "binary" | "too-large"): UntrackedRead => ({
    file: {
      path,
      oldPath: null,
      status: "added",
      additions: 0,
      deletions: 0,
      patch: "",
      hunks: [],
      omitted,
    },
  });
  const full = join(cwd, path);
  try {
    // `lstat`, so nothing is followed: what the entry IS decides, not what it points at.
    const info = await lstat(full);
    // A link is an addition of mode 120000 whose content is its target, which is what git
    // records for a tracked one — the same link reads the same way either side of the index.
    if (info.isSymbolicLink()) {
      const target = await readlink(full);
      const file = parseDiff(untrackedPatch(path, target, "120000"), {
        ...options,
        maxFileBytes: Number.POSITIVE_INFINITY,
      }).files[0];
      return file ? { file } : listed("binary");
    }
    // `ls-files --others` lists regular files and links only, so nothing reaches this;
    // it stays because a device reports size zero and `readFile` on one never returns.
    if (!info.isFile()) return { warning: `untracked entry ${path} is not a regular file` };
    // Over the limit the file is never read, so it has no counts either.
    if (info.size > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) return listed("too-large");
    const content = await readFile(full);
    if (content.includes(0)) return listed("binary");
    // The size decision was already made, against the file itself. Checking the
    // generated patch again would drop a small file for the header put on it.
    const file = parseDiff(untrackedPatch(path, content.toString("utf8"), "100644"), {
      ...options,
      maxFileBytes: Number.POSITIVE_INFINITY,
    }).files[0];
    return file ? { file } : listed("binary");
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const reason = typeof code === "string" ? code : "unknown error";
    return { warning: `untracked file ${path} cannot be read: ${reason}` };
  }
}

/** The patch git would print for the entry if it were tracked and wholly new; the path is quoted
 * the way git quotes one, because `ls-files -z` hands over tabs and newlines alike. */
function untrackedPatch(path: string, text: string, mode: "100644" | "120000"): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const tail = text.endsWith("\n") || text === "" ? "" : "\n\\ No newline at end of file";
  const before = quotePath(`a/${path}`);
  const after = quotePath(`b/${path}`);
  return (
    `diff --git ${before} ${after}\nnew file mode ${mode}\n--- /dev/null\n+++ ${after}\n` +
    `@@ -0,0 +1,${lines.length} @@\n${body}${tail}\n`
  );
}
