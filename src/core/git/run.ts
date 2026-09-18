import { execFile } from "node:child_process";
import { devNull } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** One `git diff` over the synthetic review is a few megabytes. */
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

/** The environment every git process runs in: every inherited `GIT_*` dropped,
 * only what the reader sets put back ([ADR-012](../../../docs/adr/adr-012-git-trust-model.md)). */
function readOnlyEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_CONFIG_SYSTEM = devNull;
  return env;
}

/** Configuration whose value git runs as a program, by the keys the tool can name
 * itself ([ADR-012](../../../docs/adr/adr-012-git-trust-model.md)). */
const INERT_CONFIG = [
  "core.fsmonitor=false",
  `core.hooksPath=${devNull}`,
  "core.editor=false",
  "core.sshCommand=false",
  "core.askPass=",
  "core.alternateRefsCommand=",
  "core.gitProxy=",
  "credential.helper=",
  "diff.external=",
  "gpg.program=false",
  "sequence.editor=false",
  "uploadpack.packObjectsHook=",
];

/** The half of the class whose key the repository names itself: a diff, filter, or merge driver.
 * `filter.<d>.required` is here because without it an emptied filter is fatal, not skipped. */
const DRIVER_KEY =
  /^(?:diff\..+\.(?:textconv|command)|filter\..+\.(?:clean|smudge|process|required)|merge\..+\.driver)$/;

/** `--no-pager` and the pinned configuration, ahead of the subcommand where git reads them. */
function gitArgs(args: string[], overrides: string[]): string[] {
  const config = [...INERT_CONFIG, ...overrides].flatMap((one) => ["-c", one]);
  return ["--no-pager", ...config, ...args];
}

/** Runs one git command in a repository and returns its output; every call here
 * only reads, never an index, a working tree or history (`docs/SPEC.md` section 11). */
export async function git(cwd: string, args: string[], overrides: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync("git", gitArgs(args, overrides), {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT,
    encoding: "utf8",
    env: readOnlyEnv(),
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

/** The driver keys the repository's configuration defines, each set to nothing, or `null` when the
 * question could not be asked — the caller then reads nothing ([ADR-012](../../../docs/adr/adr-012-git-trust-model.md)). */
export async function repositoryDrivers(cwd: string): Promise<string[] | null> {
  const listed = await gitOrNull(cwd, ["config", "--list", "--name-only", "-z"]);
  if (listed === null) return null;
  return listed
    .split("\0")
    .filter((key) => DRIVER_KEY.test(key))
    .map((key) => `${key}=`);
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

/** The working tree against `base`, as the renderer and the parser both read it. Plumbing, because
 * `git diff` refreshes the index on its way out and this module writes nothing (`docs/SPEC.md` 11). */
export function diff(cwd: string, base: string, overrides: string[] = []): Promise<string> {
  const args = [
    "diff-index",
    "-p",
    "-M",
    base,
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "-U3",
  ];
  return git(cwd, args, overrides);
}

/**
 * The untracked files of the working tree. Git itself never reports one in a
 * diff — only `git add --intent-to-add` would, and that writes to the index.
 */
export async function untrackedFiles(cwd: string): Promise<string[]> {
  const raw = await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return raw.split("\0").filter(Boolean);
}

/**
 * Which of `paths` git ignores, asked in one process for the whole list, or
 * `null` when git could not answer. The rules are git's own — `.gitignore` at
 * every level, `.git/info/exclude`, and the user's ignore file — and the index
 * is read, so a file that is tracked is never reported: it is in the diff
 * whatever a pattern says about it.
 *
 * `check-ignore` writes nothing, which is why it is the question to ask; `git
 * status` refreshes the index and the tool never writes to a reviewed
 * repository (`docs/SPEC.md` section 11). Exit code 1 is the answer "none of
 * them" rather than a failure; anything else — a git that will not start, a
 * repository it refuses — is `null`, and the caller does the work rather than
 * keeping an answer it did not get.
 *
 * The list arrives on standard input, which is where the errors of a pipe live:
 * a process that never started, or one that exited before it read everything,
 * makes the write fail. Unhandled, that failure is an uncaught exception in a
 * server that has no reason to stop.
 */
export function checkIgnore(cwd: string, paths: string[]): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      gitArgs(["check-ignore", "--stdin", "-z"], []),
      { cwd, maxBuffer: MAX_GIT_OUTPUT, encoding: "utf8", env: readOnlyEnv() },
      (error, stdout) => {
        if (error !== null && error.code !== 1) resolve(null);
        else resolve(new Set(stdout.split("\0").filter(Boolean)));
      },
    );
    child.on("error", () => resolve(null));
    child.stdin?.on("error", () => resolve(null));
    child.stdin?.end(paths.map((path) => `${path}\0`).join(""));
  });
}
