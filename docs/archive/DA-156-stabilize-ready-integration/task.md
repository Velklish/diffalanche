# DA-156 · Stabilize the integrated ready implementations

- **Scope:** 03-storage, 04-domain, 05-watcher, 07-server, 08-ui, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-11-01
- **Cost:** major
- **Dependencies:** the ready implementation branch and handoff are frozen before this task starts
- **Previous order:** 420
- **Taken:** 2026-11-01

## Owner authorization and workflow

The owner explicitly changed the execution order on 2026-11-01: merge ready, independently reviewed implementations locally; close cards whose specific implementation AC are evidenced; then resolve the remaining shared test, performance and integration problems as one stabilization task. The owner then instructed this session to stop after that integration and to provide a prompt for a new session that will resolve these problems.

Implementation closure is distinct from final quality acceptance. Shared eight-gate verification remains mandatory here; no failed gate becomes a pass. Original task Evidence, requirements, source SHAs and checks remain in their archive results. The exact user messages and interpretation are preserved in the handoff artifact `owner-workflow-change-20261101.json`.

## Evidence and current boundary

The run starts at `279e818b5f9ed4c1c8d07c81f6b92bb2fd5d2e8c`. The final ready-integration commit, branch, worktree and source-preservation manifest are recorded in the session handoff. Do not substitute a moving HEAD or a diagnostic overlay for that frozen input.

- Ordinary full eight-gate run at `7a1f62a5d79a3d0550884e1d106acb8459f8efea`: exit 1, 6/8. Node 1118/1118; UI 167/167. Bun 1117/1118: `tests/server.test.ts > a deleted task > forgets a task a CLI deleted and made again beside a running server, with no call of its own`, `expected 'first' to be 'second'`. Perf completed three samples, then sample 4 timed out after 60000 ms waiting for the restored file to paint at `perf/harness.ts:243`. There is no qualified five-sample median from that run.
- Matched host isolated server controls passed twice on 7a and once on pre-D07 1e. Earlier default-sandbox failures are not comparable: this selected case does not pass `recursive: false`, so the Bun test environment flag alone does not force walking. Preserve the raw sandbox and host records; they do not classify the full failure as external or refuted.
- A diagnostic server observer passed the server file 58/58 and full Bun 1118/1118, with data callbacks and reread to `second`. A separate instrumented perf observer passed 5/5 with restore painted each time. Both overlays were restored and fixtures cleaned. These are diagnostics, not ordinary qualification, and neither explains the previous failures.
- The pre-integration Core42 checkpoint at `97bf811c2c3c7b6689878071c168db1d85753da5` measured update samples 494/484/467/492/460 ms, median 484 against 300. Source-schema expectations and formatting were corrected separately. The Core cost is not remeasured on the final ready tree. A predeclared Core-only A/B packet and static bounded-concurrency design exist; measurement must precede optimization.
- A default-sandbox Node related run at `b901d619d4ec407922523ee69b8f8db3ecf983da` passed 339/340; `tests/events.test.ts` received an earlier `armed.ts` frame where it expected `streamed.ts`. Two isolated candidate runs passed and a same-sandbox baseline failed. The arm helper does not drain all frames. A matched host qualification and proof of any fixture correction remain required; do not weaken the event identity or budget checks.

Closed component findings remain fixed in the ready source: stale watch-error ownership; active child path identity; removed-directory name history; scoped delivery and held/pending document invalidation for directory-only signals. Fresh reviews cover those source deltas. Their controlled proofs are not retrospective attribution of the ordinary full failures.

## Work to do in the new session

1. Read the frozen handoff and source-preservation map, original task results, exact receipts and diagnostic limits. Verify actual branch/HEAD/status and native host permissions. Do not start a second backlog audit or reimplement the ready features.
2. Reproduce the remaining ordinary failures on the integrated tree, keeping exact names, complete assertions, commands, exits and two isolated controls plus a comparable base. Capture the failing state before fixture cleanup. Distinguish missing FS/rescan/SSE/fetch/paint from cache invalidation and fixture ordering; a nonreproduction is not a refutation.
3. Fix proved shared integration, test and perf problems surgically. Preserve Node/Bun compatibility, data schema/readability, Scope privacy, current/named windows, immutable reanchor snapshots, queue ownership and all previous review fixes. Keep `pathInScope` authorization separate from change projection.
4. Run focused checks and configured postcommit `npm run probe` for changed tests, with actual semantic assertion red and restored pass. Submit each meaningful fix to a separate independent reviewer and close critical/major findings.
5. Run the configured full workflow `npx --no-install backslop gates --require-clean --base 279e818b5f9ed4c1c8d07c81f6b92bb2fd5d2e8c --keep-going --json` on the committed final candidate. Record 8/8, commands, exits, counts and SHA. Preserve all original budgets, load guards, assertions, timeouts and platform coverage.
6. Complete the still-open specific verification dependencies when applicable: DA-110.6 three consecutive uninstrumented `env -u FORCE_COLOR bun run test:bun`; owner-authorized DA-56.9 three quiet M1 Pro perf runs on one final frozen implementation SHA, then DA-56.11 residual-latency verdict. Their cards stay open until their own AC are satisfied.
7. Perform the final current-run writer pass DA-155 over the actual base-to-final implementation range, including untouched describing surfaces, meaningful old-text checks and fresh independent documentation review. Update the original 78-ID mapping, stabilize-task result and final local status. No publication is authorized.

## Out of scope and constraints

No new product feature, runtime/model/dependency upgrade, deferred implementation, budget/guard/assertion weakening, new-minor repair, push, release, tag or package publication. No foreign process stops or lock stealing. The absent real comment corpus, unqualified unpaced CI reading, fixed-runtime browser loop and unstarted performance hypotheses stay separate open work; this task does not declare them completed. New minor findings, including the excluded-descendant notification and known duplicate CHANGELOG entry, remain registration-only.

The current session stops after ready integration and handoff; stabilization begins in the new session.

## Verification

- Final ordinary gates 8/8 with exact source SHA and raw receipts; diagnostic passes are labelled separately.
- Every fix has a proved cause or explicitly bounded behavior, relevant regression and independent review with critical=0 and major=0.
- Existing specific verification cards close only with their own required evidence; no unknown result is called refuted.
- Implementation-closed cards retain the owner-authorized shared-quality transfer and are not described as full-gate acceptance.
- The final writer pass, original-ID mapping, archive/fold history and clean-tree readback are preserved; all remaining problems and unrun checks are explicit.

## Owner acceptance decision — 2026-11-01

After receiving300ms/exit0,302ms/exit1 and RESTORE timeout/exit1(no median), the owner answered the proposal for an additional quiet series: “Закрепляем текущие результаты, они приемлемые”. The current performance result is accepted with this known deviation; the proposed extra series and further performance optimization are not run. The original numerical requirements and failed receipts remain intact. Remaining configured commands and independent documentation review are completed; no eight-of-eight success is asserted.
