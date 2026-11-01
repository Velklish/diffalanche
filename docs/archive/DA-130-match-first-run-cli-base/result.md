# Result — DA-130 · Make the first-run CLI example match the selected base

**Closed 2026-11-01.** Completed implementation under the owner-authorized workflow; shared final quality acceptance remains pending DA-156.

- **Date:** 2026-11-01
- **Outcome:** completed implementation; shared quality acceptance pending DA-156
- **Ready integration:** `5f1ba7575f899fff8d08c383f81eaebf99eee82a`; product-code snapshot `e29eeccef5b553e61d8bfd8725ac54ba46f33e93`
- **Publication:** not pushed, released or tagged

## Owner-authorized acceptance boundary

The owner explicitly approved integrating ready implementations and closing their implementation-complete cards before the shared stabilization cycle, then stopping this session. Shared test/performance/integration failures and final eight-gate acceptance are transferred to [DA-156](../../backlog/queue/DA-156-stabilize-ready-integration.md). This is implementation closure, not a claim that all gates pass or that final quality/release acceptance is complete. Original requirements and evidence are retained in task.md.

## Implemented original subjects

### DA-130

Own acceptance evidence: **DA-126, DA-129, DA-130, DA-132, DA-133**: hidden overlay draft cannot submit; current search error ends loading while stale request stays ignored; first-run CLI base example matches selected mode; all four anchor levels search/open correct thread; selected mode/branch is exposed in automated DOM/AX and keyboard/pointer checks. | UI `f8ba92f1`; `workers/ui-interactions/handoff.md`: focused Playwright commands for 126 (1), 129 (3), 130 (1), 132 (1), 133 (1) exit 0; final keyboard/threads command exit 0, 35/35; nine plus three meaningful probes mutated assertion exit 1/restored 0. `workers/ui-interactions/review-3.md` 0/0/0. Owner's `owner-answers-20261101.json` supersedes manual VoiceOver; actual reader/pronunciation remains unmeasured and is not an AC.

## Verification and review limits

Own targeted commands, exits, counts, semantic mutation results and source SHAs are cited above. Those checks remain evidence at their recorded worker revisions; they are not renamed as tests of this final integrated commit. Raw receipts stay in `/Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101`.

On the integrated code snapshot e29eeccef5b553e61d8bfd8725ac54ba46f33e93, `bun run typecheck`, `bun run check:comments`, `bun run lint`, and `npx --no-install backslop lint --require-adapter codex` each exited 0 (logs/ready-typecheck.json, ready-comments.json, ready-biome.json, ready-startup-after-init.json). Full eight gates on this combined ready tree were not run by the owner's stop/handoff instruction.

Fresh read-only Core/Stream/Native composition review at e29eeccef5b553e61d8bfd8725ac54ba46f33e93: 0 Critical/0 Major/0 Minor; 14/14 Core-only source paths match the reviewed Core input, 25/25 Stream/Native-only source paths match the reviewed other input, and the two shared files preserve both code paths. See workers/integration/ready-core-composition-review.md. Prior component reviews and registration-only minor records remain applicable to their stated scopes.

The latest ordinary full workflow before final ready integration, at 7a1f62a5d79a3d0550884e1d106acb8459f8efea, exited 1 with 6/8: Node 1118/1118 and UI 167/167 passed; Bun 1117/1118 failed the recreated-task title check; perf timed out on sample 4 RESTORE after three samples. Diagnostic observer passes are not ordinary qualification and do not refute these failures. DA-156 retains the exact commands, assertions, SHA, receipts and required final cycle.

## Remaining work

DA-156 owns shared stabilization and final quality acceptance. DA-110.6 three uninstrumented full Bun runs, DA-56.9/56.11 final quiet perf verification, DA-155 final writer, absent corpus and other unimplemented/performance/deferred subjects remain open until their own AC are met. New minors remain registration-only. No push, release, tag or package publication is claimed.

**Verification.** Targeted worker checks and independent review are recorded above at their actual SHAs. The ready integration passed typecheck, comment checks, Biome and Backslop lint with exit 0. Shared ordinary eight-gate acceptance remains pending DA-156; the last earlier full workflow was 6/8, exit 1.

**Documentation in the same pass.** Documentation and evidence from the cited implementation commits are retained. This closure updates tracker/archive links and the explicit validation transfer; it introduces no new product contract. Final current-range writer DA-155 remains part of DA-156.
