# DA-157 · Raise the end-to-end update budget to 350 ms

- **Scope:** [11-perf](../../reference/11-perf.md)
- **Created:** 2026-11-02
- **Dependencies:** none
- **Cost:** major
- **Previous order:** 1230
- **Taken:** 2026-11-02

## Context

On 2026-11-02 the owner explicitly requested raising the update budget to 350 ms. The current end-to-end row is 300 ms in `perf/budgets.ts` and SPEC section 6. This is a policy change, not a claim that runtime performance improved. Historical measurements and their original verdicts stay recorded under the budget they used.

## Work to do

- Set only the default `updateMs` budget to 350 ms and synchronize the SPEC update/diff-changed timing rows, ADR-005 current constraint, current reference guidance and directly affected comment/tests.
- Classify every related 300-ms reference as current end-to-end policy, dated measurement, independent deadline, or open-card criterion. Update current policy only; annotate historical context where needed without changing measured numbers.
- Add meaningful inclusive-boundary coverage: 350 ms passes, 351 ms fails with the actual default budgets. Keep other metric budgets and runner allowance 2.1 unchanged.
- Add one concise Unreleased entry. Root owns backlog criteria; the separate owner question about DA-56.9/56.11 is pending and does not block the authorized gate/SPEC change.

## Out of scope

- Runtime optimization or native watcher fixes, dependencies/runtime/model/browser installs, other budgets, load guards, sample counts and timeouts.
- Independent watcher-own-share 300 ms, the history-mark 300 ms times allowance (630 ms), finite 300-ms timeout fixtures, dated Phase 0/ML measurements and released CHANGELOG history.
- Retroactively turning old failed runs green, archiving blocked cards without new evidence, or automatically adding the new native hypotheses to the implementation queue.

## Verification

- Show actual semantic failure with the old 300-ms default: two isolated repeats plus an actual detached BASE with candidate regression but unchanged production. Retain full assertions and exact commands/exits/counts.
- Commit first, then configured mutation probes: restoring 300 must fail the positive boundary; raising to 351 must fail the negative boundary. Restore exact source/hash and passing checks.
- Run targeted lint before committed-clean configured full8 with the real task BASE, matched host permissions and existing browser cache. Preserve the first failed perf packet without retry/replacement. Any new nonperf red needs two isolated repeats and actual BASE.
- Fresh independent review covers the full code/tests/docs diff and reference inventory. Acceptance requires all mandatory gates and root integration/readback/archive mechanics. Historical Node/Bun failures are not waived by this budget amendment.
