import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { byCodePoint } from "../order.ts";
import type { BaseSpec, FileChange, RepositoryChange, ResolvedBase } from "../types.ts";
import { DEFAULT_MAX_FILE_BYTES, type PatchOptions, parseDiff } from "./patch.ts";
import {
  currentBranch,
  defaultRemote,
  diff,
  mergeBase,
  remoteDefaultBranch,
  revParse,
  untrackedFiles,
} from "./run.ts";

export type { PatchOptions } from "./patch.ts";
export { DEFAULT_MAX_FILE_BYTES, parseDiff } from "./patch.ts";

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

/**
 * Reads the change set of one repository: the working tree against the resolved
 * base, with untracked files as additions. Git is read through the binary and
 * never written to — no index, no working tree, no history
 * (`docs/SPEC.md` section 11).
 *
 * A repository whose base did not resolve comes back with no files and a
 * warning, which is how `ref` mode skips it.
 */
export async function readRepositoryChange(
  root: string,
  repoPath: string,
  spec: BaseSpec = { mode: "head" },
  options: PatchOptions = {},
): Promise<RepositoryChange> {
  const cwd = join(root, repoPath);
  const [branchName, resolution] = await Promise.all([currentBranch(cwd), resolveBase(cwd, spec)]);
  if (!resolution.base) {
    return {
      path: repoPath,
      branch: branchName,
      base: null,
      files: [],
      warnings: resolution.warnings,
    };
  }
  const [raw, untracked] = await Promise.all([diff(cwd, resolution.base.sha), untrackedFiles(cwd)]);
  const files = parseDiff(raw, options);
  const warnings = [...resolution.warnings];
  for (const path of untracked) {
    const one = await readUntracked(cwd, path, options);
    if ("file" in one) files.push(one.file);
    else warnings.push(one.warning);
  }
  files.sort((a, b) => byCodePoint(a.path, b.path));
  return { path: repoPath, branch: branchName, base: resolution.base, files, warnings };
}

/**
 * `ls-files --others` names entries, and an entry is not always a readable file:
 * a dangling symbolic link, a link to a directory, or a file deleted between the
 * listing and the read. One of those must not cost the whole review, so it costs
 * a warning and its own line of the change set.
 */
type UntrackedRead = { file: FileChange } | { warning: string };

/**
 * An untracked file is an addition. A staged new file is already in the diff and
 * is not listed here, so the two sources never count the same file twice.
 */
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
    const info = await stat(full);
    // Over the limit the file is never read, so it has no counts either.
    if (info.size > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) return listed("too-large");
    const content = await readFile(full);
    if (content.includes(0)) return listed("binary");
    // The size decision was already made, against the file itself. Checking the
    // generated patch again would drop a small file for the header put on it.
    const file = parseDiff(untrackedPatch(path, content.toString("utf8")), {
      ...options,
      maxFileBytes: Number.POSITIVE_INFINITY,
    })[0];
    return file ? { file } : listed("binary");
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const reason = typeof code === "string" ? code : "unknown error";
    return { warning: `untracked file ${path} cannot be read: ${reason}` };
  }
}

/** The patch git would print for the file if it were tracked and wholly new. */
function untrackedPatch(path: string, text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const tail = text.endsWith("\n") || text === "" ? "" : "\n\\ No newline at end of file";
  return (
    `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n` +
    `@@ -0,0 +1,${lines.length} @@\n${body}${tail}\n`
  );
}
