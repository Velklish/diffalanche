# DA-64 · serve exits 1 when a data-directory file is unreadable, against the documented contract

- **Order:** 40
- **Scope:** 06-cli, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`docs/reference/07-server.md` is explicit: a `comments.json` that is not JSON, a
`review.json` of another schema version, a `current` holding a path rather than a
name — "all of those are the 500 … The server starts anyway — the change set is
read at start-up as a warm-up, not as a gate."

The server keeps that promise.
[src/server/serve.ts:71](../../../src/server/serve.ts) swallows everything that
is not a `DomainError` and writes a warning, with a comment saying why: "a server
that refused to start would leave the person with no way to see why."

The CLI then reads the same document a second time, for the line under the
address, and rethrows.
[src/cli/commands/serve.ts:43](../../../src/cli/commands/serve.ts):

```ts
  } catch (error) {
    if (error instanceof DomainError) {
      return "  no current review session: create one with `diffalanche review new <name>`\n";
    }
    throw error;
  }
```

Reproduced from source on this tree — a fresh root, one repository, one session,
`comments.json` replaced with `{ broken`:

```
$ bun run src/cli/index.ts serve --root <root> --port 48899
the review could not be read: …/reviews/s1/comments.json: not valid JSON: JSON Parse error: Expected '}'
diffalanche: …/reviews/s1/comments.json: not valid JSON: JSON Parse error: Expected '}'
SERVE EXIT=1
```

Two lines, and the second one is fatal: the socket is already open and the
watcher already running when `process.exit(code)` at
[src/cli/index.ts:22](../../../src/cli/index.ts) kills them.

The consequence is the one the server's comment predicts. `GET /api/warnings`
and the 500 that would name the file and the field are both behind a server that
is no longer there, so a hand-edited file — which `docs/SPEC.md` section 3
calls an ordinary event — leaves the person with one line and no interface.

## Work to do

- Make the summary line tolerate what the server tolerates: a document that
  cannot be read produces a line saying so, not a rethrow.
- Decide what that line says. It has to be distinguishable from "no current
  review session", because the remedy differs, and it should point at the screen
  that will name the file.
- Check the other start-up readers for the same shape. The pattern here is one
  module deciding a failure is survivable and a second module reading the same
  thing and disagreeing; `grep` for further `review.document()` callers before
  closing.
- Record in `docs/reference/06-cli.md` what `serve` exits non-zero for. The
  reference describes the server's tolerance and says nothing about the CLI's.

## Out of scope

- Repairing a broken `comments.json`. Reporting it is the contract; fixing it is
  not.
- The schema-version half of the same sentence, unless the check finds it takes
  the same path.

## Verification

- The reproduction above starts the server and stays up: `serve` prints a
  warning and the summary line, the process is still running after ten seconds,
  and `GET /api/warnings` answers.
- A test covers it — a session with an unreadable `comments.json`, asserting the
  server serves — and reverting the fix turns it red.
- `diffalanche serve` on a root with no current session still prints the
  first-run line, unchanged.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.
