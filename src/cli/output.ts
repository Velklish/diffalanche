/**
 * Where a command writes. JSON goes to `out` and nothing else does, so
 * `diffalanche list --json | jq` never has a warning mixed into it
 * ([ADR-004](../../docs/adr/adr-004-agent-contract.md)).
 */
export type Output = {
  out: (text: string) => void;
  err: (text: string) => void;
  /**
   * All of standard input, for the `--body -` of `reply` and `comment`. The
   * entry points leave it out and `src/cli/stdin.ts` answers instead; a test
   * gives its own rather than reading the runner's own standard input.
   */
  input?: () => Promise<string>;
};

/** What a stream of a real process looks like to this module. */
type Stream = {
  write: (text: string) => unknown;
  on: (event: "error", listener: (error: NodeJS.ErrnoException) => void) => unknown;
};

/** The streams of a real process, guarded; both entry points go through it, so
 * one cannot have the handler and the other not ([06-cli.md](../../docs/reference/06-cli.md)). */
export function processOutput(out: Stream = process.stdout, err: Stream = process.stderr): Output {
  return { out: guarded(out, "standard output", err), err: guarded(err, "standard error", err) };
}

/** A writer that stops on a reader that went away and reports anything else. */
function guarded(stream: Stream, name: string, err: Stream): (text: string) => void {
  let gone = false;
  stream.on("error", (error) => {
    // `diffalanche diff | head` is a normal way to use a CLI: the reader got
    // what it asked for, so there is nothing to report and nothing to fail.
    if (error.code === "EPIPE") {
      gone = true;
      return;
    }
    // A full disk on a redirected stdout is not that, and must not be swallowed
    // with it: output the person asked for did not arrive.
    process.exitCode = 2;
    if (stream !== err) err.write(`diffalanche: ${name}: ${error.message}\n`);
  });
  return (text) => {
    if (!gone) stream.write(text);
  };
}

/** The one JSON writer: two-space indentation and a closing newline, as the data directory is written. */
export function json(io: Output, value: unknown): void {
  io.out(`${JSON.stringify(value, null, 2)}\n`);
}

/** A row of a human-readable table: every column padded to the widest cell. */
export function table(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
