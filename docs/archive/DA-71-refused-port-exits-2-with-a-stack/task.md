# DA-71 · A refused listening socket exits 2 with a stack trace instead of the documented one-line error

- **Scope:** 06-cli, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

`serve` words the two ways a listening socket is refused by hand, and then throws
them as a bare `Error`, which the CLI's top-level catch treats as a fault it did
not expect.

[src/server/serve.ts:138-149](../../../src/server/serve.ts):

```ts
if (code === "EADDRINUSE") {
  return new Error(
    `port ${port} is already in use: stop the diffalanche that holds it, or run with --port <n>`,
  );
}
if (code === "EACCES") {
  return new Error(`port ${port} is not allowed for this user: run with --port <n> above 1023`);
}
return error instanceof Error ? error : new Error(String(error));
```

Nothing between there and the exit code changes its class:
[src/cli/commands/serve.ts:63-67](../../../src/cli/commands/serve.ts) awaits
`startReviewServer` with no `try`/`catch`, and
[src/cli/run.ts:94-103](../../../src/cli/run.ts) maps `UsageError`,
`DomainError` and `StorageError` to the one-line exit 1 and everything else to
`output.err(error.stack ?? error.message)` and `return 2`. `listenError` builds
none of the six classes `grep -rn "class \w*Error" src/core src/server src/cli`
finds, so it lands in the second branch every time.

Reproduced on Node v25.2.1, from source, on an empty root:

```
$ node src/cli/index.ts serve --port 1 --root /tmp/da71root
EXIT=2
Error: port 1 is not allowed for this user: run with --port <n> above 1023
    at listenError (.../src/server/serve.ts:147:12)
    at startReviewServer (.../src/server/serve.ts:121:11)
    … four more frames, down to .../src/cli/index.ts:18:14
```

The contradiction is with [07-server.md:29-34](../../reference/07-server.md),
which prints the busy-port outcome as the sentence standing alone, and with what
exit 2 means in [06-cli.md:127-131](../../reference/06-cli.md) — "anything the
tool did not expect", which a failure `serve.ts` words on purpose is not. The
exit-1 row of that table does not itself enumerate a refused socket, so the two
documents do not decide the code between them: that is the decision this task
carries. The cost is bounded — the helpful sentence reaches the person either
way, and nothing in `skills/` shells out to `serve` — so what is broken is the
contract a wrapper reads, not the message a human reads.

No test pins either side. [tests/server.test.ts:333-341](../../../tests/server.test.ts)
asserts `rejects.toThrow(/port \d+ is already in use/)` at the library level and
never runs the CLI, which is how the drift survived.

## Work to do

- Decide which code a refused socket gets, and record the decision where the
  contract lives. The candidates: give `listenError` a class the exit-1 branch
  already recognises (`UsageError` is the closest fit, since `--port` is a flag
  the person can change); catch it in [src/cli/commands/serve.ts](../../../src/cli/commands/serve.ts)
  and print plus `return 1` there; or declare exit 2 correct for a refused socket
  and fix `07-server.md` to show the stack. The first two need the exit-1 row of
  `06-cli.md` widened to cover a refusal that comes from the environment rather
  than from the domain or storage.
- Keep the fall-through at `serve.ts:149` on exit 2. An `EPERM`, an `EAFNOSUPPORT`
  or anything else the function does not word is exactly what exit 2 is for, and
  a fix that catches the whole `startReviewServer` call would swallow those too.
- Whatever is chosen, make the message match the rest of exit 1: `run.ts:99`
  prefixes `diffalanche: ` and flattens newlines, so the sentence a user sees
  changes shape and `07-server.md`'s block has to show the shape it now has.

## Out of scope

- The unwritable data directory, which reaches exit 2 by the same catch from a
  different source: [DA-99](../DA-99-unwritable-data-directory-is-a-stack-trace/task.md).
- `serve` exiting 1 on an unreadable data file, which is the opposite drift:
  [DA-64](../DA-64-serve-exits-on-unreadable-data/task.md).
- The missing `stdout` error handler that crashes a piped CLI:
  [DA-91](../DA-91-piped-cli-output-crashes-on-epipe/task.md).
- The wording of the two sentences. They are good; only their exit code and the
  stack around them are in question.

## Verification

- `node src/cli/index.ts serve --port 1 --root <empty dir>` and a second `serve`
  on a port the first holds both produce whatever the decision says, and the two
  reference sections say the same thing as the code.
- A CLI-level test carries it. [tests/cli.test.ts:363-376](../../../tests/cli.test.ts)
  already has the `exit code 2` block with the shape to copy — it asserts
  `result.code`, that `result.err` contains `at `, and that stdout is empty. The
  new case asserts the refused socket's code and that stderr is one line, so
  reverting `listenError` to a plain `Error` (or removing the new catch) turns it
  red.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  `bun run perf` is untouched by this change but is in `gates` and runs anyway.
