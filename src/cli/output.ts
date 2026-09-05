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
