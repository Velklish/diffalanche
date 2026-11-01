# Final delta review — stream/UI documentation currency

Frozen predecessor: `c51dd229680630cae1bed94b6d321040d15935f5`.
Frozen reviewed documentation: `5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e`.
Measured implementation: `a87e98927cb171464d3fc4911653412f931ccab7`.

**Delta verdict: 0 Critical / 0 Major / 0 new Minor. Both Major findings from `writer-stream-ui.md` are closed.** The prior source-comment Minor remains open and is now registered as DA-155.2; registration is not a correction or closure. This addendum supersedes the prior report's blocking verdict only for the inspected correction delta.

## Corrected contracts

- `docs/reference/07-server.md:646–652` and `08-ui.md:315–317` now distinguish broadcast comment/unscoped frames from server-filtered session-targeted `diff-changed` delivery and replay. They retain one global ring/id sequence and correctly allow gaps in a connection's delivered ids. This agrees with immutable `src/server/events.ts:79–99,142–144,197–200`; that source file is unchanged by this delta. The obsolete registry-only/filter-rejection claims are absent from both reference files.
- `docs/ROADMAP.md:10` now states that automatic Git/text re-anchoring and orphaned status are implemented while model/UI proposals, LSP, Windows verification and phase acceptance remain open/deferred. It agrees with the current README/domain reference and does not claim phase acceptance.
- Watcher same-bytes silence is now conditioned on both an unchanged entry and no persisted anchor changes. `05-watcher.md:863–873` explicitly describes the anchor-only Ready/current-event/activity/cache-write path. This agrees with `src/core/watcher/index.ts:771–798`, where the no-change branch requires `sameChange(...) && !reconciled.changed`; the changed branch calls Ready and writes the cache. The companion source comments do not change execution.
- The `reanchor.ts` delta only moves `SCAN_CONCURRENCY` within the same named import. No symbol or module changes. DA-155.1/155.2 source comments remain untouched. DA-155.3 is a registration-only glossary finding from the sibling review, not a new implementation.

The amended documentation table tests contain explicit old-text controls for both stream surfaces and the roadmap, plus the anchor-only and dated measurement statements. Their assertions were inspected statically; this reviewer did not execute the tests or probes. The owner's new 14 probes were pending when this review was assigned and remain a separate verification receipt obligation.

## Dated measurements checked against retained raw evidence

`docs/reference/11-perf.md:887–906` matches `stabilization/qualification-v3-perf.json` and the three `logs/qualification-v3-perf-N.{json,stdout,stderr}` records:

| Recorded command on implementation a87e989 | Result in raw records | Documentation verdict |
|---|---|---|
| `env PLAYWRIGHT_BROWSERS_PATH=/Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101/browsers bun run perf`, invocation 1 | five complete samples; update median 300 ms; 7/7 budgets; exit 0; guard waits 125 s and admits at load 6.44/19.73 | exact |
| same command, invocation 2 | five complete samples; update median 302 ms; 6/7 budgets; exit 1 | exact |
| same command, invocation 3 | three complete samples, updates 301/299/326; sample 4 times out at RESTORE after 60000 ms; no final median table; exit 1 | exact |

The before/after one- and five-minute loads in the document match the aggregate and raw receipts. All three receipts record unchanged a87e989 HEAD, clean status before/after, `require_escalated`, and no `GITHUB_ACTIONS` or `DIFFALANCHE_PERF_IGNORE_LOAD` override. This is evidence read from retained runs, not new execution by this reviewer.

`05-watcher.md:1136–1141` matches all three ordinary `env -u FORCE_COLOR bun run test:bun` receipts and stdout summaries: **1255/1255 tests, 87/87 files, exit 0 each**, at a87e989. The document preserves unknown native failure causality and qualifies the measured source, not the later documentation SHA.

The separate five-restore diagnostic sentence is supported by `workers/restore-timeout/result.md` and `receipt.json`: that was **7a1f62a5 plus a harness-only diagnostic overlay**, not the a87e989 ordinary series. The current paragraph correctly says it neither refutes the ordinary timeout nor establishes cause; no a87e989 qualification is inferred from it here.

`OWNER-ACCEPTED-CURRENT-RESULTS.json` records the owner's decision to retain these results as acceptable and stop additional perf work. Its decision does not change the numeric outcomes. The documentation makes no 3/3 perf, ordinary 8/8 gate or causal-load claim, and budgets/deadlines remain unchanged.

## Read-only verification receipts and remaining boundary

Executed in the writer worktree, immutable objects only:

```sh
git diff --stat c51dd229680630cae1bed94b6d321040d15935f5 5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e
```

Exit 0; 10 changed paths. The complete scoped document/source/test delta was read with `git diff` and numbered `git show SHA:path` excerpts, exit 0.

```sh
git diff --exit-code c51dd229680630cae1bed94b6d321040d15935f5 5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e -- src/server/events.ts src/core/watcher/bus.ts src/ui/search.ts perf/budgets.ts perf/harness.ts perf/gate.ts backslop.json
```

Exit 0; these routing, registered-comment, budget, harness and configured-gate files are unchanged.

```sh
git grep -n -E 'registry, not a filter|registry and not a filter|per-connection filter was' 5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e -- docs/reference/07-server.md docs/reference/08-ui.md
```

Exit 1; no obsolete claim remains in those two references.

A Python SHA-256 readback of stdout/stderr named by all six qualification receipts returned exit 0: **12/12 raw streams match their recorded SHA-256**. No test, probe, browser, native-runtime or perf command was executed by this reviewer. No product/repository files were edited; only this external addendum was written.

Remaining ownership: the owner completes the final ledger's documentation-SHA/section attribution, new probe receipts and remaining ordinary commands separately. This static verdict is not whole-workflow acceptance and does not close registration-only minor findings. The historical `writer-stream-ui.md` remains the record of the c51dd229 findings.
