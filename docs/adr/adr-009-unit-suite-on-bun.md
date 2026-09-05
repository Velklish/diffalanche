# ADR-009: The unit suite also runs on Bun's runtime

**Status:** Accepted
**Revises [ADR-006](adr-006-verification.md):** the smoke matrix is no longer the only thing that executes on Bun — the unit suite runs on both runtimes.
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

[ADR-006](adr-006-verification.md) weighed running the unit suite on both
runtimes against a smoke scenario on both, and chose the smoke scenario:
"running the whole unit suite twice is slow and mostly redundant". The
measurement below overturns the first half of that sentence, and DA-13/DA-14
found what the second half hides.

`bun run test` reads as though the suite runs on Bun. It does not: Bun starts
Vitest, and Vitest runs the tests themselves on Node. A probe writing
`process.execPath` and `process.versions` out of a test says so, and
`tests/cli-comments.test.ts` corroborates it — it spawns the CLI with
`process.execPath` and gets Node. So nothing executed the core on Bun's own
runtime, while `docs/SPEC.md` section 10 asks for CI green on Node and on Bun.

The smoke matrix of DA-15 does not close this. It runs the CLI on both runtimes,
which covers the surface an agent uses; it does not cover storage's lock, the
git reader, or the watcher, whose behaviour on the two runtimes is where a
difference would sit.

Evidence, on an M1 Pro:

| Command | `process.execPath` in a test | `process.versions.bun` | Suite |
|---|---|---|---|
| `bun run test` | the Node binary | undefined | 246 tests, 15.0 s |
| `bunx --bun vitest run` | the Bun binary | `1.3.14` | 246 tests, 11.0 s |

The two rows are one pair, measured back to back on an M1 Pro with the machine
busy; a quieter pair gives 10.1 s against 8.9 s. The absolute numbers move with
the load, the order does not — the Bun run has been the faster of the two in
every pair measured.

## Options

- **What runs on Bun → the whole suite / a hand-picked subset.** The subset is
  the runtime-sensitive modules: storage's lock, the git reader, the watcher.
  It is smaller to run and is a list that goes stale the first time a module is
  added to it, silently — nothing fails when a new runtime-sensitive test is
  written outside the list.
- **Which runner → Vitest under Bun / `bun test`.** `bunx --bun vitest run`
  keeps the one suite the project has. `bun test` is Bun's own runner with its
  own API: the same files would have to pass under two runners, and a failure
  would not say which of the two disagreed.
- **How the runtime is known → asserted / trusted.** A job that believes its own
  name passes quietly the day the runner goes back to spawning Node workers,
  which is exactly the failure this ADR exists to answer.

## Decision

- The whole unit suite runs on both runtimes: `bun run test` on Node,
  `bun run test:bun` (`bunx --bun vitest run`) on Bun. Both are Vitest.
- CI runs the Node half in `check` and the Bun half in `test-bun`.
- `tests/runtime.test.ts` compares the runtime it finds against
  `DIFFALANCHE_TEST_RUNTIME` — `bun` from `test:bun`, `node` when nothing sets
  it. The claim "this job ran on Bun" is asserted by the suite, not by the job's
  name.
- The smoke matrix of ADR-006 stays as it is: it answers a different question,
  the delivery channels.

## Consequences

- CI grows one job of about the length of `check`. The Bun run is the faster of
  the two, so runtime parity costs less than ADR-006 assumed.
- A dependency that breaks on one runtime fails the suite of that runtime, with
  the failing test naming the module — rather than surfacing as a CLI smoke
  failure that has to be traced back.
- Every new test is written for both runtimes. A test that can only pass on one
  of them is a finding about the code, not a reason to split the suite.
- `bun test` stays out of the project: the suite is written against Vitest.
