# DA-91 · The CLI installs no error handler on stdout, so piping into a reader that exits early crashes it

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The CLI entry point hands `process.stdout.write` to the command layer and never listens for the
stream's errors.

[src/cli/index.ts:18-22](../../../src/cli/index.ts)

```ts
const code = await run(process.argv.slice(2), ui, {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
if (code !== 0) process.exit(code);
```

`grep -rn 'process\.on' src` returns nothing, so there is no handler anywhere. The `try`/`catch` in
`run` (src/cli/run.ts:88-104) that exists to map every failure onto an exit code cannot see this
one: `process.stdout.write` returns a boolean and the EPIPE arrives later as an `'error'` event on
the socket, not as a rejection of the awaited `dispatch`.

The writes are single and large, so the pipe buffer is no protection: `diff` emits the whole change
set in one call (`context.io.out(patch(shown))`, src/cli/commands/diff.ts:110) and `--json` does the
same (`io.out(\`${JSON.stringify(value, null, 2)}\n\`)`, src/cli/output.ts:19), against a synthetic
review of 30,000 diff lines (docs/SPEC.md:117).

Reproduced on node v25.2.1, a single 300 KB `process.stdout.write` into a reader that stops early:

```
$ node -e 'process.stdout.write("x".repeat(300000))' | head -c 10 >/dev/null
node:events:486
      throw er; // Unhandled 'error' event
      ^
Error: write EPIPE
```

with the writer exiting 1. The same write of 1 000 bytes exits 0 — it fits the pipe buffer and never
reaches the closed end — and a reader that lingers before exiting (`| (sleep 0.3; exit 0)`) also
produces exit 1, so the trigger is the size of the write rather than a race.

Two narrowings against the way this was first stated.

It is not an exit code outside the table. The uncaught `'error'` event exits 1, and 1 is in
[docs/reference/06-cli.md:127-131](../../reference/06-cli.md). What is wrong is the output the user
gets for it: the table says code 1 prints "one line on stderr, `diffalanche: ` and the message", and
what actually lands is a Node internals stack trace. The CLI reports a refusal it did not make.

It is not both delivery channels. The npm channel is `dist/cli.js`, built `--target node`
(scripts/build.ts:141) and named in `package.json` under `bin`, so it runs on Node and crashes. The
binaries are compiled `--target=bun-<platform>-<arch>` (scripts/build.ts:145-154) and Bun does not
abort: the same 300 KB write under `bun -e` into `head -c 10` exits 0 with an empty stderr. So this
is a Node-channel defect, which is also the channel `bun run dev` and every run from source use.

The documented pipe example is safe. `diffalanche diff --json | jq` (README.md:236,
docs/reference/06-cli.md:135) reads all of its input, so it never closes the pipe early.

## Work to do

- Install an `'error'` listener on `process.stdout` (and `process.stderr`) before the first write,
  so an EPIPE stops being an unhandled event. `process.stdout.on` exists on both runtimes — checked,
  `typeof` is `function` under node v25.2.1 and bun — so this stays inside the Node/Bun shared
  surface the project requires.
- Decide what EPIPE should mean, and write it into the exit-code table. The candidates are: exit 0,
  on the grounds that the reader got what it asked for and `head` is a normal way to use a CLI; or
  the shell convention of exiting on SIGPIPE, which is what a tool that pipes into `head` usually
  does. A stack trace is not one of the candidates. Any other stream error — a full disk on a
  redirected stdout — must still be reported rather than swallowed with the EPIPE.
- Put the handler in one place. The wiring at src/cli/index.ts:18-21 is duplicated verbatim in the
  binary entry that `scripts/build.ts:112-116` generates, so a handler added to only one of them
  leaves the other as it is; either both entries call a shared helper or the ownership of the
  streams moves somewhere both already go through.
- Update docs/reference/06-cli.md:125-131 with the decided behaviour, since the table is the
  contract an agent reads.

## Out of scope

- Chunked or back-pressure-aware writing. The single large write is the shape of the output, not the
  defect, and making the writes incremental would change the diff command without closing this.
- The server's writes to stderr (src/server/app.ts:114, src/server/serve.ts:75,89), which are not on
  the piped path, and `serve`'s other startup failures, filed as
  [DA-71](../../archive/DA-71-refused-port-exits-2-with-a-stack/task.md) and
  [DA-64](../../archive/DA-64-serve-exits-on-unreadable-data/task.md).

## Verification

- A test spawns the real entry point with output past the pipe buffer, closes the reader early, and
  asserts the decided exit code and an empty stderr. This needs a real process rather than the
  in-process `run` the rest of tests/cli.test.ts uses; tests/cli-comments.test.ts is the precedent —
  it spawns the CLI with `execFile` for exactly the cases only a process can show.
- Removing the handler turns that test red with the `Unhandled 'error' event` trace.
- A second case asserts that a non-EPIPE stream error is still reported, so the handler is not a
  blanket swallow.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` are green; `bun run perf`
  is untouched by this change but is part of the gate set.
