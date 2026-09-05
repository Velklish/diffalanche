import { execFile } from "node:child_process";
import { devNull } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** One `git diff` over the synthetic review is a few megabytes. */
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

/**
 * Runs one git command in a repository and returns its output. Every call here
 * only reads: nothing in this module writes an index, a working tree, or
 * history (`docs/SPEC.md` section 11). `GIT_CONFIG_GLOBAL` and
 * `GIT_CONFIG_SYSTEM` point at the platform's null device, so a developer's own
 * git configuration cannot change what the tool reads.
 */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  });
  return stdout;
}

/** The same, for a command whose failure is an answer: an unresolved ref, a missing remote. */
export async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/** The revision a name points at, or `null` when it does not resolve to a commit. */
export async function revParse(cwd: string, rev: string): Promise<string | null> {
  const sha = await gitOrNull(cwd, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  return sha ? sha.trim() : null;
}

/** The checked-out branch, or the abbreviated revision when HEAD is detached. */
export async function currentBranch(cwd: string): Promise<string> {
  const name = (await gitOrNull(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
  if (name && name !== "HEAD") return name;
  return (await gitOrNull(cwd, ["rev-parse", "--short", "HEAD"]))?.trim() ?? "HEAD";
}

/**
 * The remote a base branch is looked up on: `origin` when it exists, otherwise
 * the first remote the repository has, and `null` when it has none.
 */
export async function defaultRemote(cwd: string): Promise<string | null> {
  const remotes = ((await gitOrNull(cwd, ["remote"])) ?? "").split("\n").filter(Boolean);
  if (remotes.includes("origin")) return "origin";
  return remotes[0] ?? null;
}

/**
 * The default branch of a remote, as `refs/remotes/<remote>/HEAD` records it:
 * `origin/main`. The symbolic ref exists only when the clone set it up, which a
 * `git init` fixture never does.
 */
export async function remoteDefaultBranch(cwd: string, remote: string): Promise<string | null> {
  const ref = await gitOrNull(cwd, [
    "symbolic-ref",
    "--quiet",
    "--short",
    `refs/remotes/${remote}/HEAD`,
  ]);
  return ref ? ref.trim() : null;
}

/** The best common ancestor of two revisions, or `null` when their histories are unrelated. */
export async function mergeBase(cwd: string, left: string, right: string): Promise<string | null> {
  const sha = await gitOrNull(cwd, ["merge-base", left, right]);
  return sha ? sha.trim() : null;
}

/** The working tree against `base`, in the form the renderer and the parser both read. */
export function diff(cwd: string, base: string): Promise<string> {
  return git(cwd, ["diff", base, "--no-color", "--no-ext-diff", "-U3"]);
}

/**
 * The untracked files of the working tree. Git itself never reports one in a
 * diff — only `git add --intent-to-add` would, and that writes to the index.
 */
export async function untrackedFiles(cwd: string): Promise<string[]> {
  const raw = await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return raw.split("\0").filter(Boolean);
}
