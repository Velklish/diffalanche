/**
 * What the CLI itself refuses: a flag that is not there, a value that is not
 * one of the choices, a command nobody typed. The domain and storage have their
 * own error types and the dispatcher treats all three the same — exit code 1
 * and one line on standard error.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * The one refusal for a `--repo` that names no repository under the root. Both
 * the command that scans and the command that anchors give it, and a reader who
 * met it once should not have to work out whether the second wording means
 * something else.
 */
export function repositoryNotFound(repo: string): UsageError {
  return new UsageError(`--repo: no repository "${repo}" under the root`);
}
