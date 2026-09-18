/** Why a git call failed, told apart by what Node reports rather than by which helper ran it.
 * The four shapes and how they are recognised are in `docs/reference/02-git.md`. */
export type GitFailure = "not-started" | "exited" | "killed" | "too-large";

/** Everything the git layer refuses, carrying which of the four it was and what git said.
 * `repositoryFault` is true when one repository is at fault and its neighbours still read. */
export class GitError extends Error {
  readonly failure: GitFailure;
  /** The exit code git returned, or `null` when it never ran or was killed. */
  readonly exit: number | null;
  /** The first line of what git wrote to standard error, empty when it wrote nothing. */
  readonly stderr: string;

  constructor(failure: GitFailure, message: string, exit: number | null, stderr: string) {
    super(message);
    this.name = "GitError";
    this.failure = failure;
    this.exit = exit;
    this.stderr = stderr;
  }

  /** Whether one repository is at fault, rather than the machine the tool runs on. */
  get repositoryFault(): boolean {
    return this.failure === "exited" || this.failure === "too-large";
  }
}

/** The first line of git's complaint, without the `fatal:` git puts on it: the warning it ends
 * up in already says what kind of thing it is. */
function firstLine(stderr: string): string {
  const line = stderr.split("\n").find((one) => one.trim() !== "") ?? "";
  return line.replace(/^(fatal|error|warning):\s*/, "").trim();
}

/** The taxonomy, read off the error `execFile` rejects with; the discriminator is the TYPE of
 * `code` — a string is the spawn's errno, a number is git's own exit code. */
export function gitError(command: string, error: unknown): GitError {
  const shape = error as { code?: unknown; signal?: unknown; stderr?: unknown } | null;
  const stderr = typeof shape?.stderr === "string" ? firstLine(shape.stderr) : "";
  const code = shape?.code;
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new GitError(
      "too-large",
      `git ${command} printed more than the reader can hold`,
      null,
      stderr,
    );
  }
  if (typeof code === "number") {
    const said = stderr === "" ? "" : `: ${stderr}`;
    return new GitError("exited", `git ${command} exited ${code}${said}`, code, stderr);
  }
  if (typeof shape?.signal === "string") {
    return new GitError("killed", `git ${command} was killed by ${shape.signal}`, null, stderr);
  }
  const errno = typeof code === "string" ? code : "unknown error";
  return new GitError("not-started", `git could not be started: ${errno}`, null, stderr);
}
