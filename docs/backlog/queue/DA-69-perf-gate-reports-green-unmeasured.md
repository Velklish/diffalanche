# DA-69 · The perf gate reports green on what it did not measure: a missing metric passes, and a drifted fixture is not detected

- **Order:** 200
- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The gate is one of the `gates` in `backslop.json`, run before any task is reported, and on a development machine it runs at allowance 1 — the strict numbers, which [11-perf.md:349-361](../../reference/11-perf.md) says is the point: a budget only CI enforces stops being one. Two things let it print `ok` for a line it has no number for.

**The freshness check is one file's existence, and the fixture in this checkout has already drifted past it.** [perf/gate.ts:21-28](../../../perf/gate.ts):

```ts
function prepare(fixture: string): void {
  const current = join(fixture, ".diffalanche", "current");
  if (!existsSync(fixture) || !existsSync(current)) {
```

`current` exists whatever it points at. Read off disk in this checkout today:

```
$ cat .perf/fixture/.diffalanche/current
synth-b
$ ls .perf/fixture/.diffalanche/reviews/
synth  synth-b  synth-b-b
synth-b-b threads: 40 replies: 0
synth-b   threads: 40 replies: 0
synth     threads: 200 replies: 67
```

`synth-b` is the harness's own scratch session for measuring a switch, given exactly `OTHER_COMMENTS = 40` comments ([perf/harness.ts:269-308](../../../perf/harness.ts)). `createSession` makes it current and only the `finally` at harness.ts:311-317 puts the pointer back, so a run killed between the two leaves `current` on the scratch session — which is how a `synth-b-b` came to exist at all, `${current}-b` applied to a `current` of `synth-b`. The drift is then permanent: harness.ts:284 `if (await sessionExists(config.dataDir, other)) return { current, other };` returns early, so the pair is reused on every subsequent run. `bun run perf` here measures a 200-comment review's budgets against a session with 40 comments and no replies, at allowance 1. Comment load is what drives the thread widgets, the per-line severity marks and the rail, so `firstRenderMs`, `cpuPerFrameMs` and `scrollLongTasks` are all read at a fifth of the specified load. CI is honest about this by accident — `.github/workflows/ci.yml:89` regenerates the fixture before the run — but CI is the lenient run, at `RUNNER_ALLOWANCE` 2.5.

A second staleness the same check misses: `.perf/fixture/.diffalanche/reviews/synth/diff.json` opens `"version": 1` with no `scope` field, while `SCHEMA_VERSION = 2` ([src/core/storage/types.ts:9](../../../src/core/storage/types.ts)) and `parseDiffCache` discards both cases ([src/core/storage/schema.ts:207,214](../../../src/core/storage/schema.ts)).

One point the finder got wrong, and it narrows the fix: the run is not silent about which session it measured. harness.ts:254-259 writes `sessions <current> and <other>` to stderr. What is missing is anyone comparing that name against what the generator makes.

**A budget line with no measurement passes.** [perf/budgets.ts:103-107](../../../perf/budgets.ts):

```ts
const measured = median(measurements.map((one) => one[field]));
const failed = budget.pendingUntil === undefined && measured > ceiling;
return { budget, measured, ceiling, failed };
```

Nothing asserts the value is finite, and `0 > 8.3` and `NaN > 500` are both false. The feed has a silent fallback: harness.ts:229 `return result.metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;`. If Chromium ever stops reporting `TaskDuration`, both samples become 0, `cpuPerFrameMs` becomes `0.0`, and the tightest line of the table — 8.3 ms budget against 6.4 ms measured (11-perf.md:368), the stand-in for 120 fps — prints `ok` for ever while the scroll path degrades without limit. `formatTable` (budgets.ts:113-131) renders `row.measured` verbatim, so the zero reads as an ordinary number. The corrected reach: the harness does send `Performance.enable` before `getMetrics`, so with the pinned Chromium the metric is present and this is hardening rather than a live defect; and the `?? Number.NaN` companion at harness.ts:141 is a type fallback for a `null` the store cannot currently produce — `perf.responseAt` is stamped at store.ts:545, one line before the only `status: "ready"` — so it is not the reachable half.

`tests/perf.test.ts` covers the median rule, the runner allowance, pending lines and the long-task line, but every field of its `measurement()` helper (tests/perf.test.ts:7-23) is a plausible number, so no case asks what happens to `0` or `NaN`.

## Work to do

- Make `evaluate` refuse a non-finite or absent measurement rather than compare it: a line whose number cannot be trusted has to be distinguishable from a line that passed. Decide which it is — an exception that fails the gate, or a third verdict beside `ok`/`FAIL`/pending that prints and exits non-zero. Failing outright is simpler; a distinct verdict keeps the rest of the table readable when one metric disappears.
- Decide what `taskDuration` does when the metric is missing. The `?? 0` is what makes the silence look like a measurement; throwing there moves the failure to where the cause is named.
- Give the fixture a provenance the gate can check, and regenerate when it does not match. Candidates: the generator stamps what it wrote — the session name, the comment and reply counts, the schema version — into a file `prepare` reads back; or `prepare` asserts the invariants directly, that `current` names the generator's session and that its `comments.json` holds the specified counts. Either way the `-b` scratch session must not be able to satisfy the check.
- Make the harness's scratch session recoverable rather than sticky: `sessionExists` returning early (harness.ts:284) is what turns one killed run into a permanently wrong fixture. Either the scratch session is rebuilt each run, or its name does not compose with itself.
- Say in [11-perf.md](../../reference/11-perf.md) what the gate now guarantees about the thing it measured; the section on which numbers are enforced where is the place for it.

## Out of scope

- `prepare`'s `rmSync` of any `--fixture` directory, filed as [DA-63](DA-63-perf-gate-erases-fixture.md). It is the same eight lines and the same function, and whichever lands first will touch the other's context, but they are different defects: one deletes what it was pointed at, this one fails to notice what it kept.
- Repairing the drifted `.perf/fixture` on this machine. That is one `bun run synth -- --out .perf/fixture`; the entry is about the run not telling anyone.
- The budgets themselves, and `sessionSwitchMs`, which is pending on DA-24.1.

## Verification

- A `Measurement` with `cpuPerFrameMs: 0` — and one with `NaN` — makes `evaluate` report that line as not measured, and `bun run perf` exits non-zero. Reverting the check turns those cases red, which is what tests/perf.test.ts does not have today.
- A fixture whose `current` points at the `-b` session, or whose comment counts do not match the generator's, is regenerated or refused by `prepare` rather than measured. Pointing `current` at `synth-b` by hand and running the gate is the reproduction.
- After the change, `.perf/fixture` regenerated from scratch and one killed run mid-`twoSessions` leave the next run measuring `synth` with 200 comments.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, and `bun run perf` on a freshly generated fixture, with the printed table and the session line in the report.
