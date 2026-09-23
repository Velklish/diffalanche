/** The model or its runtime is not there to load: an answer the CLI gives in one line with
 * exit code 1, like every other refusal, and not a fault with a stack (06-cli.md). */
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}
