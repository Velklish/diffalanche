/** What the CLI itself refuses: an unknown flag, a value off the choices, no command; the
 * dispatcher treats it as the domain's and storage's errors — exit 1, one line (06-cli.md). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** The one refusal for a `--repo` naming no repository under the root: `diff` and `comment`
 * both give it, so a reader who met it once need not wonder whether a second wording differs. */
export function repositoryNotFound(repo: string): UsageError {
  return new UsageError(`--repo: no repository "${repo}" under the root`);
}
