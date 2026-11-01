# Final documentation delta review — Core / Native and recorded measurements

**Reviewed candidate:** `5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e`, compared with `c51dd229680630cae1bed94b6d321040d15935f5`. Runtime measurement source remains `a87e98927cb171464d3fc4911653412f931ccab7`.

**Result: 0 new Critical / 0 open Major / 0 new Minor.** The Major in `writer-core-native.md` is corrected. Its existing Minor remains intentionally unfixed and registered as **DA-155.3 — Warning glossary omits derived lost-anchor warnings**. This is documentation-review acceptance of the frozen delta, not perf qualification or final configured-gate acceptance.

## Previous Major closed

The event table, same-bytes description, repository callback, first-rescan explanation, cache-write paragraph and source comments now consistently condition the quiet current path on **both** an unchanged repository entry and no persisted anchor changes. The new cache paragraph explicitly retains Ready, current diff event, activity and cache persistence for an anchor-only change.

Compared current text in `docs/reference/05-watcher.md:77,620,650,724,866` and `src/core/watcher/index.ts:304-310` with the unchanged behavior at `src/core/watcher/index.ts:757-798`: the quiet predicate remains `sameChange(before, change) && !reconciled.changed`. The matching server explanation at `docs/reference/07-server.md:342-350` preserves the same distinction. No behavior change was introduced by this correction.

The only other production-source delta is import ordering in `src/core/domain/reanchor.ts`; it does not change the imported symbols or execution.

## New measurements match retained evidence

The new Bun paragraph (`docs/reference/05-watcher.md:1136-1140`) accurately names the measured SHA rather than claiming the later docs candidate ran that series. Read all three `logs/qualification-v3-bun-{1,2,3}.json` receipts and their stdout/stderr:

- Exact command: `env -u FORCE_COLOR bun run test:bun`.
- Each source before/after: `a87e98927cb171464d3fc4911653412f931ccab7`, clean status before/after.
- Each exit **0**; each stdout reports **87 passed files and 1255 passed tests**.
- The three ordinary runs remain separate from the earlier failed series and instrumented diagnostics. The new text retains unknown native cause and does not claim a production-native fix.

The new perf paragraph/table (`docs/reference/11-perf.md:887-906`) matches all three `qualification-v3-perf.json` entries and `logs/qualification-v3-perf-{1,2,3}.{json,stdout,stderr}`:

| Invocation | Complete samples | Update median | Exit | Verification |
|---|---:|---:|---:|---|
| 1 | 5 | 300 ms | 0 | Seven stdout budget rows pass; guard waited 125 s and admitted at loads 6.44/19.73. |
| 2 | 5 | 302 ms | 1 | Six stdout budget rows pass; update row fails the unchanged 300 ms budget. |
| 3 | 3 | absent | 1 | Retained updates 301, 299, 326; fourth sample fails at the restore wait with `Timeout 60000ms exceeded`. |

All before/after one- and five-minute loads in the documentation match receipt values rounded to two decimals. The ordinary timeout stack points to `perf/harness.ts:243`, which is the restore-painted wait after writing the original file back (`:236-249`), not the initial edit wait. The third stdout contains no median table. The documentation neither fabricates its median nor attributes the timeout to load.

I verified the SHA256 of all **12/12** stdout/stderr files against the six ordinary-run receipts. This is retained-evidence readback, not a rerun.

The separate diagnostic claim also has supporting evidence: `residual-profile/ANALYSIS.json` names a87 and marks the run instrumented, not absolute qualification; all five referenced raw `diagnostic-*.json` files contain a final `restore-painted` event and no failure, and **5/5** raw hashes match that analysis. The diagnostic command receipt `logs/residual-profile-one.json` still reports exit **1**; the text claims five completed restores, not a passing diagnostic perf gate. Its stdout/stderr hashes also match **2/2**. The diagnostic does not refute the ordinary timeout or establish cause, as the text correctly states.

`host-runtime-readback.json` retains five successful read-only version/hardware commands: Node v25.2.1, Bun 1.3.14, Darwin 27.0.0 arm64, eight physical cores and Apple M1 Pro. It also records Playwright Chromium **revision 1243**, browser version 153.0.8010.12, and the two owned revision1243 cache directories. The documentation's `Chromium 1243` identifies that pinned revision. This hardware readback was taken after the qualification series; source/runtime continuity during qualification is established by the owner's execution record, not independently remeasured by this reviewer.

## Other changed text and regression evidence

- The server/UI corrections accurately distinguish broadcast comment/unscoped frames from server-filtered targeted diff frames. `src/server/events.ts:79-99` filters live/replay by session while `:64-76,89-103` retains global ids and ring bounds; `:142-145` only targets `diff-changed`. No new finding in these changed paragraphs.
- The ROADMAP correction separates implemented automatic Git/text re-anchoring and orphan status from deferred model/UI/LSP/Windows work and open Phase3 acceptance. It does not claim phase completion.
- `docs/backlog/minor/DA-155.3-glossary-anchor-warning-source.md` registers the previous glossary finding with code/doc evidence. `docs/GLOSSARY.md` itself is unchanged, as requested.
- Readback of the new documentation controls: previous text at `4ad6f0dff99309f8f8611bbd8ba20179083cca73` fails **14/24**, with **10/24** passing, twice, both exit1. Baseline `603d11b8354786f6fbc2cb318534e4d91a481d45` fails **24/24**, exit1. Current `5c5ec108` passes **31/31 in 2 files**, exit0, for `bun run test -- tests/documentation-contracts.test.ts tests/stabilization-documentation.test.ts`. These are owner-produced raw receipts/stdout read by this reviewer, not reviewer-executed tests.
- The v2 probe summary lists 14 controller exits0 with semantic review marked pending at readback. No additional semantic-probe acceptance is inferred from controller exit0. The owner is checking assertion outcomes and hashes separately.

## Commands and boundaries

Repository objects were read with `git show SHA:path`, `git diff c51dd229..5c5ec108` and numbered source extraction; these inspection calls exited **0**. The specific frozen comparisons returned no diff and exit0:

```sh
git diff --exit-code a87e98927cb171464d3fc4911653412f931ccab7 5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e -- docs/SPEC.md perf package.json backslop.json
git diff --exit-code c51dd229680630cae1bed94b6d321040d15935f5 5c5ec1081c6cb9a0f13e0baf6cd3ad14ad14a29e -- docs/GLOSSARY.md
```

Thus the budgets, perf harness/gate source and configured commands were not changed by this docs candidate. Artifact readback and the Python SHA256 checks also exited **0**. One exploratory `rg` used three nonexistent guessed artifact filenames and exited **2**; it supplied no evidence. The correct owner-provided paths above were subsequently read successfully.

No runtime/heavy tests, perf reruns, probes or repository modifications were executed by this reviewer. Only this addendum was written. Working-tree mutation probes were not repository-review inputs.

## What remains deliberately outside acceptance

`OWNER-ACCEPTED-CURRENT-RESULTS.json` records the owner's direct decision to preserve the current measured results and stop further perf runs/optimization. The evidence is still **one passing complete invocation, one failing complete invocation, one incomplete invocation**. Owner acceptance does not turn that into three consecutive passing perf runs or a changed budget.

The final seven configured commands are outside this review and were still being run by the owner. No 8/8 gate claim, publication, additional performance qualification or native root-cause claim is made. DA-155.3 remains registration-only.
