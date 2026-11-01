# DA-148 · Validate the Bun watcher suite after lifecycle fixes

- **Order:** 840
- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. After watcher fixes, investigate native path feasibility and full-suite/probe interaction; preserve independent outcomes.

## Work to do

- [DA-110.5 — Bun's test runner may no longer need the walk now that Linux watches per directory](../minor/DA-110.5-bun-runner-may-watch-with-the-watch-per-directory.md)
- [DA-110.7 — Full test:bun runs with the probe's test file reddened tests/watcher.test.ts in 2 of 6, without it in 0 of 2](../minor/DA-110.7-watcher-red-in-full-bun-runs-with-the-probe-test.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-110.5

# DA-110.5 · Bun's test runner may no longer need the walk now that Linux watches per directory

- **Scope:** [05-watcher](../../reference/05-watcher.md#what-the-unit-tests-hold)
- **Created:** 2026-09-29
- **Parent:** DA-110.3
- **Cost:** minor

## Evidence

Finding discovered while working on DA-110.3. `tests/watcher.test.ts` walks under
`bun run test:bun` because a watch there "goes quiet after its first events":

<!-- quote:../../../tests/watcher.test.ts -->
```ts
const NATIVE_WATCH = process.env.DIFFALANCHE_TEST_RUNTIME !== "bun";
```
<!-- /quote -->

With that line set to `true` on the DA-110.3 branch, where Linux takes one watch
per directory, one run of `DIFFALANCHE_TEST_RUNTIME=bun bunx --bun vitest run
tests/watcher.test.ts` passed 47 of 49. The two reds were the new DA-110.3 cases,
each at its first index move (`no diff-changed for repos/core/cargos-api naming
.git/index`, `.git/index was not heard after the step`). They assert the target's
name, and Bun's watch names the lock, so the reds are about names and not about a
quiet watch. One run on a 4-core container, so this is a hypothesis about the
runner, not a measurement. Whether Bun's own recursive watch, which the suite
avoided, was what went quiet is not checked. If it holds, the suite could exercise
the watch on both runtimes, and the two cases would accept the lock's name under
Bun.


### Retained original DA-110.7

# DA-110.7 · Full test:bun runs with the probe's test file reddened tests/watcher.test.ts in 2 of 6, without it in 0 of 2

- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-10-04
- **Parent:** DA-110.6
- **Cost:** minor (hypothesis)

## Evidence

Finding discovered while working on DA-110.6.

Evidence: Full runs of `env -u FORCE_COLOR bun run test:bun` with `tests/mutation-probe.test.ts` in the suite reddened `tests/watcher.test.ts` in 2 of 6, with different cases; without the file, in 0 of 2. Red cases: "watcher > asks git again once the index has moved" (`Error: no diff-changed for repos/core/cargos-api naming .gitignore` at `waitForChangeOf` tests/watcher.test.ts:249:39) and "watcher > says nothing about a burst git ignores, and wakes when the rules stop ignoring it" (`AssertionError: expected [ Array(1) ] to deeply equal []`, a `diff-changed` with `files: []` for repos/core/cargos-api), both in run 1 on `974a193`; "watcher > says nothing about a path .git/info/exclude names" (`AssertionError: expected [ { event: { …(3) }, …(1) } ] to deeply equal []`, the same empty `diff-changed`) in run 1 on `e1dffe0`. Runs with the file: `974a193` #1 red, #2 green; `e1dffe0` #1 red, #2 green, and a third whose `--exclude` did not reach the unit project (63 files) green — the DA-124 worker's records evidence-probe.md and evidence-probe-2.md, 2026-10-03, macOS, under the bus's machine lease, not re-measured here; and the DA-124 approver's run on `c79226d` with the DA-124 squash, 2026-10-03 21:37 UTC, load 45.59 over one minute at its start: exit 1 with 6 failed, all DA-110.6's, `tests/watcher.test.ts` green. Runs without the file: the full suite on `3c962f7`, and on `e1dffe0` with the file left out (62 files). `tests/watcher.test.ts` alone on Bun: `974a193` twice exit 0, `3c962f7` twice exit 0. A/B on `e1dffe0` under one lease, A = `tests/watcher.test.ts` alone, B = with `tests/mutation-probe.test.ts`: B red and A green in 0 of 4 pairs, all 8 runs green (50 and 57 tests), load 5.5 to 18 over one minute, 2026-10-03 20:56-20:59 UTC (evidence-probe-3.md). No link to the new file is established: 2 of 6 against 0 of 2 does not separate the file from the load, and the cases are of the timing-dependent kind DA-110.2 fixed once. Regression check: a record of 10 full `test:bun` runs on macOS with the file in the suite, under the machine lease at load 15 or more over one minute, kept in the verification of the batch that closes this entry; it is red when any run fails in `tests/watcher.test.ts`, and the same 10 runs with the file left out say whether the file or the load is the cause.
