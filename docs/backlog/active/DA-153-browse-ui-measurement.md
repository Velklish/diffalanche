# DA-153 · Measure browse tree and first-render costs

- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor
- **Previous order:** 890
- **Taken:** 2026-11-01

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Bounded browse tree/first-render measurements with separate verdicts; no unrelated redesign.

## Work to do

- [DA-37.4 — The all files tab renders every path of every repository, unvirtualised](../minor/DA-37.4-all-files-tab-at-scale.md)
- [DA-37.5 — First render costs about 8 ms more since browse mode](../minor/DA-37.5-first-render-costs-eight-ms-more.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Current budget amendment — 2026-11-02

The owner raised the end-to-end update budget to 350 ms. Future SPEC-budget-backed qualification uses 350 ms. The original 300-ms requirements and readings retained as context describe the earlier policy; measurements, exit codes and verdicts are unchanged. Independent deadlines, load guards, counts and timeouts are unchanged.

## Retained source requirements

### Retained original DA-37.4

# DA-37.4 · The all files tab renders every path of every repository, unvirtualised

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Parent:** DA-37
- **Cost:** minor (hypothesis)

## Evidence

Found by the review of DA-37 (reviewer:browse, finding 11), not measured. `allFiles` in
`src/ui/components/Sidebar.tsx` turns every file of every repository of the review into a row,
and each unchanged row subscribes to the store twice — whether it is the open file, and its
comment count:

<!-- quote:../../../src/ui/components/Sidebar.tsx -->
function UnchangedRow({ repo, path }: { repo: string; path: string }) {
<!-- /quote -->

The synthetic review has about twenty files a repository, so neither the UI suite nor the perf
gate reaches the case. Hypothesis: on a repository of 10 000 files the tab is slow to open and
every store update — a live patch, a keystroke in the filter — runs 20 000 selectors.

The numbers that settle it, on a fixture of one repository with 10 000 tracked files and a
review of 20 changed ones: the time from the press on `all files` to the painted frame, and the
time of one live update with the tab open against the same update with the `changes` tab open.
Against `docs/SPEC.md` section 6 the first is a jump (50 ms) and the second an update (300 ms).
Over either, the tab needs a window of rows or branches collapsed by default.


### Retained original DA-37.5

# DA-37.5 · First render costs about 8 ms more since browse mode

- **Scope:** 08-ui, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Parent:** DA-37
- **Cost:** minor

## Evidence

Measured by worker:browse of run 0923 on the track tip `a572e79` against its base `5a5f8e8`, one
lock hold, six `perf/run.ts` processes interleaved, three a side, load average 30.69 falling to
16.67 on 8 cores — above the ceiling of [ADR-013](../../adr/adr-013-perf-gate-off-ci.md), so a tendency
rather than proof (the run's `evidence-browse-round2.md`). The first render line, in ms:

| run | base | branch |
|---|---|---|
| 1 | 96.0 | 104.4 |
| 2 | 89.6 | 102.1 |
| 3 | 93.9 | 101.3 |

Medians 93.9 / 102.1: +8.2 ms, larger than either side's spread (6.4 / 3.1). The budget is 500 ms
(`docs/SPEC.md` section 6), so the line stays green; the other lines of the same runs showed no
difference beyond their spreads.

The acceptance's own alternation does not show it: `f9691e9` (the track integrated into `main`)
against `3b338a9`, three `perf/run.ts` processes a side at a load of 10.9–13.6 on 8 cores, below
the ceiling, gave first render 103.9 / 92.3 ms — base 103.9, 90.1, 127.0; tip 103.3, 92.3, 89.8 —
spreads 36.9 / 13.5. The two series disagree, so the cost is not settled either way.

Hypothesis, not measured: the cost is the per-card work DA-37 added to `FileCard` — the patch
scan behind `expandable` and the new-side line set of every card that carries threads:

<!-- quote:../../../src/ui/components/FileCard.tsx -->
      !file.patch.includes("\ndiff --git "),
<!-- /quote -->

What settles it: first render on a quiet machine, `a572e79`'s `FileCard` against the same with the
two memos stubbed, three runs a side.

## Owner-approved retained-subject update — 2026-11-01

DA-37.5 current-subject replacement: The owner selected matched current-code comparisons because exact a572e79 cannot be recovered locally or through GitHub. Before new data, freeze one current implementation SHA and compare its FileCard with the same source and harness except for the two identified memos stubbed. Keep three fresh processes per side, quiet-load qualification, declared alternation and all raw data. Record the actual memo regions and output/measurement boundaries before running. Historical +8.2ms and missing-tree attribution remain unknown; a current comparison is not a refutation of that historical result.
