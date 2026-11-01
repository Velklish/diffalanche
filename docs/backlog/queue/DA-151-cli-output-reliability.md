# DA-151 · Reliable CLI broken-reader handling and stderr fixtures

- **Order:** 870
- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Broken reader handling and hermetic CLI stderr test environment, independent assertions.

## Work to do

- [DA-115.2 — A reader that goes away can surface as ENOTCONN, which the CLI reports and exits 2 on, where EPIPE is swallowed](../minor/DA-115.2-cli-stdout-enotconn-reported.md)
- [DA-119.1 — The CLI's empty-stderr test fails when the caller's environment sets both NO_COLOR and FORCE_COLOR](../minor/DA-119.1-cli-test-stderr-inherits-color-env.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-115.2

# DA-115.2 · A reader that goes away can surface as ENOTCONN, which the CLI reports and exits 2 on, where EPIPE is swallowed

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-24
- **Parent:** DA-115
- **Cost:** minor

## Evidence

Finding discovered while working on DA-115, in the gate series on its tip `8689795` (a rerun of `bun run test` under `/tmp/da-perf.lock`, 2026-09-24 09:17–09:18 UTC, one-minute load 9.9–15.2 on 8 cores). DA-115 does not touch the CLI: `git diff --stat cd3debe 8689795 -- src/cli src/core src/server tests` is empty.

`tests/cli.test.ts > output piped into a reader that stops early > ends at 0 with an empty stderr instead of an unhandled error event` failed once:

```
AssertionError: expected 'diffalanche: standard output: write E…' to be '' // Object.is equality

- Expected
+ Received

+ diffalanche: standard output: write ENOTCONN
```

It passed alone twice on `8689795`, twice on `cd3debe`, and ten more times in a row on `8689795` right after (exit 0 each), so it is rare. The code says why it can happen at all: the guard on the CLI's streams treats only `EPIPE` as a reader that went away, and reports anything else with exit code 2.

<!-- quote:../../../src/cli/output.ts -->
```ts
    if (error.code === "EPIPE") {
      gone = true;
      return;
    }
```
<!-- /quote -->

That `ENOTCONN` comes from the child's stdout being a socket rather than a pipe — which is what Node and Bun give a child spawned with `stdio: "pipe"` on macOS, as far as the author knows — is an assumption, not checked here. What is checked is that the CLI printed `write ENOTCONN` for a reader that stopped early, which is the case the test exists for.

## Work to do

- Decide whether `ENOTCONN` on a write to stdout or stderr means the reader went away in every case the CLI can meet, and if so treat it as `EPIPE` is treated; say which codes in 06-cli.md.
- Make the test able to produce the other code, or say in it why it cannot.

## Verification

- The verdict above holds whichever of the two codes the reader's departure surfaces as — on 2026-09-24 it met `ENOTCONN` once in fifteen runs on `8689795` (two suites of the gate series, one rerun, twelve alone) — and a stdout that fails for another reason still exits 2 with its message.


### Retained original DA-119.1

# DA-119.1 · The CLI's empty-stderr test fails when the caller's environment sets both NO_COLOR and FORCE_COLOR

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-10-03
- **Parent:** DA-119
- **Cost:** minor

## Evidence

Finding discovered while working on DA-119. The test "output piped into a reader
that stops early > ends at 0 with an empty stderr instead of an unhandled error
event" inherits the caller's environment, so Node's warning about the colour
variables lands in the stderr it expects to be empty. Measured by the orchestrator
on `8236520`, 2026-10-03, Node 25.2.1:

```
$ NO_COLOR=1 FORCE_COLOR=1 bunx vitest run tests/cli.test.ts   # exit 1
AssertionError: expected '(node:93909) Warning: The \'NO_COLOR\…' to be '' // Object.is equality
+ (node:93909) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
      Tests  1 failed | 47 passed (48)

$ env -u FORCE_COLOR NO_COLOR=1 bunx vitest run tests/cli.test.ts   # exit 0
      Tests  48 passed (48)
```

A session whose harness sets both variables sees `bun run test` red on an
unchanged tree.
