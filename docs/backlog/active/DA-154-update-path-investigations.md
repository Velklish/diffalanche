# DA-154 · Validate update-path cost hypotheses

- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor
- **Previous order:** 900
- **Taken:** 2026-11-01

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Quiet isolated comparative measurements on update path, separate hypotheses/criteria and no speculative optimization.

## Work to do

- [DA-76.4 — parseDiff may cost about 10 ms on the rescan path: baseline() separates on three points a side, post-hoc](../minor/DA-76.4-parse-diff-may-cost-ten-ms-on-the-rescan-path.md)
- [DA-60.1 — The update line reads higher on the landed tree than on its base, inside the spread](../minor/DA-60.1-update-line-higher-on-the-tip-by-alternation.md)
- [DA-39.1 — An update after an edit may wait for the symbol index to read the changed files](../minor/DA-39.1-update-waits-for-the-symbol-index.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-76.4

# DA-76.4 · parseDiff may cost about 10 ms on the rescan path: baseline() separates on three points a side, post-hoc

- **Scope:** 02-git, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-22
- **Parent:** DA-76.1
- **Cost:** minor (hypothesis)

## Evidence

Found while accepting DA-76.1 into `main`, chasing the one red of the integration gate — `tests/watcher.test.ts > watcher > rescans the edited repository alone and has the new hunk in diff.json in time`, the verdict DA-60 already names.

`baseline()` in that test is the median of three `rescanRepository` calls, which is `readRepositoryChange` and so `parseDiff` with almost nothing else around it. DA-76.1 changes `parseDiff` — about fifty lines in `src/core/git/patch.ts`, folding an adjacent deleted-plus-added pair on one path and walking `files` to find it. So a cost added there lands on the rescan path, and `baseline()` is the closest thing the suite has to a direct reading of it.

**The measurement.** Eight runs of `tests/watcher.test.ts` alone, alternating the pre-merge base `8db629b` against the merged tree `e69f21f`, under one holding of the machine lock 21:11:11Z to 21:13:56Z on 2026-09-21, load 9.2 to 15.0 throughout. The base side ran from a detached checkout in a separate worktree, the merged side in the clone root. `baseline()` is not printed on a green run, so it was made visible by a one-line change in the working copy of the checkout — the value named and written to `stderr`, the inequality itself unchanged — applied before each run and reverted after it, never committed. `tests/watcher.test.ts` is byte-identical on the two trees (`git diff 8db629b e69f21f -- tests/watcher.test.ts` is empty), so both sides ran one instrument and not two. All eight exited 0 at 37 of 37.

| # | tree | `median(elapsed)` | `baseline()` |
|---|---|---|---|
| 1 | `8db629b` base | 263.9 ms | 109.0 ms |
| 2 | `e69f21f` merged | 240.0 ms | 126.9 ms |
| 3 | `8db629b` base | 292.0 ms | 67.7 ms |
| 4 | `e69f21f` merged | 252.2 ms | 78.3 ms |
| 5 | `8db629b` base | 239.4 ms | 59.6 ms |
| 6 | `e69f21f` merged | 238.6 ms | 77.6 ms |
| 7 | `8db629b` base | 232.8 ms | 75.1 ms |
| 8 | `e69f21f` merged | 273.0 ms | 78.4 ms |

**What the table gives, and what dissolves it, both kept here on purpose.**

- Over all eight the `baseline()` ranges **overlap**: base 59.6–109.0, merged 77.6–126.9. On the whole sample there is no separation and no finding.
- The first run of each side — 109.0 and 126.9 — sits above the other three of its own side, on both sides, which looks like warm-up.
- Dropping those two, the rest separates completely: base 67.7, 59.6, 75.1 (mean 67.47) against merged 78.3, 77.6, 78.4 (mean 78.10); `max(base) = 75.1 < min(merged) = 77.6`; the difference of means is **+10.63 ms on about 70 ms**, roughly 16%.
- The merged three lie within **0.8 ms** of one another where the base three spread over **15.5 ms**. That is not what noise usually looks like, and it is the second reason this entry exists.

**Why this is a hypothesis and not a finding.** The exclusion of the first run per side was decided **after** seeing the numbers. A criterion chosen on the data has to be checked on new data, not on the same data, and three points against three would be thin even if it had been declared in advance. Nothing here establishes a regression.

**What the same run ruled out.** The neighbouring suspicion — that the branch had slowed the test's own `median(elapsed)` — did not survive. Base 232.8–292.0, mean 257.02; merged 238.6–273.0, mean 250.95: the merged range lies inside the base range and its mean is the lower of the two. An earlier two-point reading (base 258.1 and 241.3, merged 262.7 and 443.1) had looked like a clean separation and was withdrawn against these four points a side; the 443.1 was an outlier, not a level.

**One structural note that makes a green verdict weak here.** `parseDiff` stands on *both* sides of the assertion at `tests/watcher.test.ts:350` — `median(elapsed)` measures a path through it, and `BUDGET_MS + baseline()` is the budget plus another path through it. A slowdown in `parseDiff` raises the ceiling along with the measurement, so the verdict partly cancels its own signal. Whatever the answer is, it will not come from that verdict going green.

## Work to do

Two measurements, in this order, with their criteria fixed **before** the run.

- **A direct microbenchmark of `parseDiff`**, on a fixture with a type change and one without, on the tree before and after the DA-76.1 commit. It hits the mechanism instead of its shadow three layers up. Declare before running: one process per side, sides alternated, and the repeat count named in advance. This is not ceremony — in this same track a reading taken with both sides in one process in a fixed order produced "`measurePatch` is 28% faster on the branch", which was JIT warm-up measured alongside the code and was withdrawn.
- **`baseline()` at six runs a side**, with the exclusion of each side's first run **written into this card before the run**. That turns today's post-hoc choice into a stated hypothesis tested on new points.

If the separation holds under a criterion declared in advance, the cost is real and belongs on a task of its own; if it does not, close this entry and say so, because the plausible-looking mechanism is exactly what makes a false positive here expensive.

## Out of scope

- The wall-clock flakiness of the verdict itself, which is [DA-60](../../archive/LOG.md#da-60). The ceiling this test computes for itself moved 59.6 → 126.9 on a quiet machine tonight and stood at 160.07 and 193.98 under a full gate chain: that spread is DA-60's first item and not this entry's subject.
- The suite's weight. The branch adds fourteen verdicts, 600 against the 586 `main` carried, over three test files, which makes the chain heavier and the verdict is load-sensitive — but taking part in a red by weight is not taking part by content, and only the weight is established.
- `notes` as an out-parameter of `parseDiff`, which is [DA-76.3](../../archive/LOG.md#da-76.3).


### Retained original DA-60.1

# DA-60.1 · The update line reads higher on the landed tree than on its base, inside the spread

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-24
- **Parent:** DA-60
- **Cost:** minor (hypothesis)

## Evidence

Found at the integration of DA-55.6 and DA-60 into `main`. **A tendency, not a
difference:** by DA-110 an alternation whose ranges overlap proves nothing, and
the landing went ahead on that ruling.

"Update after an edit in one repository" (budget 300 ms), one
`bun perf/run.ts --fixture .perf/fixture --variant default --runs 1` process a
run, alternating the base `7a26d8b` and the landed tree (`3ce1373` with the
toast test's fix, no change under `src/` or `perf/` between them), under one
hold of `/tmp/da-perf.lock`, 2026-09-23 23:28:18–23:29:45Z, 8 cores:

| run | tree | load (1 / 5 / 15 min) at start | update ms |
|---|---|---|---|
| 1 | base | 8.21 9.44 10.88 | 302 |
| 1 | tip | 8.67 9.49 10.87 | 338 |
| 2 | base | 8.88 9.50 10.85 | 301 |
| 2 | tip | 8.79 9.44 10.81 | 400 |
| 3 | base | 8.97 9.44 10.78 | 352 |
| 3 | tip | 10.10 9.64 10.83 | 333 |

Medians 302 and 338 ms, spreads 51 and 67 ms. The integration's own
`bun run perf` on `3ce1373` (load 16.78 at its start) read 453 / 313 / 308 ms.
The worker's alternation of the branch's base `54b2c28` and `2316d89`, loads
6.92–9.52, read 321 / 314 / 353 / 329 ms with identical failure sets — no
tendency there.

Neither task changes the edit's path under `src/`: DA-55.6 changes the watcher's
move of `current`, and DA-60 changed no file under `src/`. DA-60 did change what
the harness does after it has measured an update — item 8, a wait for the
restore's paint where there was a 500 ms sleep:

<!-- quote:../../../perf/harness.ts -->
```ts
    // The restore is an update of its own, down the path this function measures: the next run
    // starts once the card has painted it, not after a sleep that load could outlast.
    await page.evaluate(() => {
      window.__perf.liveUpdate = null;
    });
    await writeFile(target, original);
    restored = true;
```
<!-- /quote -->

## Work to do

- For the perf wave: does the wait for the restore by event (item 8) change what
  the update line measures — for example, what state the fixture's `diff.json`
  and the next process's startup read are left in — or is 302 against 338 the
  machine? Alternate the two trees again on a quiet machine, more runs a side,
  and with the harness of each side swapped, before reading anything into it.


### Retained original DA-39.1

# DA-39.1 · An update after an edit may wait for the symbol index to read the changed files

- **Scope:** 11-perf, 07-server, 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Parent:** DA-39
- **Cost:** minor

## Evidence

Found by the acceptance of the browse track of run 0923. The integration gate on `f9691e9` (the
track on top of `3b338a9`) measured `Update after an edit in one repository` at 306 ms against the
300 ms budget (317, 306, 305; load 17.78 falling to 13.38 on 8 cores), every other line green.
Alternated in one lock hold with `3b338a9`, three `perf/run.ts` processes a side at a load of
10.9–13.6 on 8 cores (1.4–1.7 a core, below the ceiling of
[ADR-013](../../adr/adr-013-perf-gate-off-ci.md)):

| run | base `3b338a9` | tip `f9691e9` |
|---|---|---|
| 1 | 286 | 290 |
| 2 | 279 | 299 |
| 3 | 279 | 324 |

Medians 279 / 299 ms, spreads 7 / 34: the difference is larger than the base's spread and smaller
than the tip's, so a tendency and not proof. The worker's own alternation of the track alone,
`a572e79` against `5a5f8e8`, had 288 / 285 — no difference.

The mechanism is on the update's path. Once a review has been read, the symbol index subscribes to
the server's own stream, and every `diff-changed` has it read the changed files again with
tree-sitter on the server's event loop:

<!-- quote:../../../src/server/routes/search.ts -->
        void made.changed(data.repo, files).catch(() => {});
<!-- /quote -->

Candidate: `diff-changed` only marks the files stale, and the next symbol question reads them.
What settles it: the update line on a quiet machine, the tip against the same with the
subscription removed, three runs a side.
