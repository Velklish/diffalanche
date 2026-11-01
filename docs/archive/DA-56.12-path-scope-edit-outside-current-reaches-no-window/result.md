# Result — DA-56.12 · An edit a named task's path scope covers and the current one's does not reaches no window on that task

**Closed 2026-11-01.** Completed implementation under the owner-authorized workflow; shared final quality acceptance remains pending DA-156.

- **Date:** 2026-11-01
- **Outcome:** completed implementation; shared quality acceptance pending DA-156
- **Ready integration:** `5f1ba7575f899fff8d08c383f81eaebf99eee82a`; product-code snapshot `e29eeccef5b553e61d8bfd8725ac54ba46f33e93`
- **Publication:** not pushed, released or tagged

## Owner-authorized acceptance boundary

The owner explicitly approved integrating ready implementations and closing their implementation-complete cards before the shared stabilization cycle, then stopping this session. Shared test/performance/integration failures and final eight-gate acceptance are transferred to [DA-156](../../backlog/queue/DA-156-stabilize-ready-integration.md). This is implementation closure, not a claim that all gates pass or that final quality/release acceptance is complete. Original requirements and evidence are retained in task.md.

## Implemented original subjects

### DA-56.12

Own acceptance evidence: **DA-56.12** | Reviewed source handles named-path edits outside current through built/pending scope, copied paths and held-document eviction; review1/review2 majors are closed in `review-3.md`. Related 145/145 Node/Bun at c666; 22/22 `tests/followed-scope.test.ts` at c337 Node/Bun exit 0; two c337 configured guard probes each mutated named FAIL exit 1/restored exit 0 (`C337-HANDOFF.md`, raw `final-{after-read-left,known-captured-leave}-probe.*`). | The preceding 21-case test and c337 one-case addition are not a fresh 146-case related suite. The c337 delta is test-only relative to reviewed c666 production, but root must retain the independent final test-delta review in its receipt.

The later directory-only-signal integration Major was corrected at bfd6703d6329a57c8695c15a94aebbcf83ae7d1a: scoped notifications project onto explicit allowed descendant paths, and both held and pending documents invalidate. Authorization pathInScope is unchanged. Host Node/Bun 12-file commands each passed 149/149, supplementary checks 22/22 each; three configured postcommit probes each had a named assertion failure with mutation and pass after restore. Exact commands/exits: workers/stream-directory-scope-fix/HANDOFF.md and logs/directory-host-related12-{node,bun}.json. Independent stream-composition-review-2.md: 0 Critical/0 Major/1 registration-only Minor DA-56.14.

## Verification and review limits

Own targeted commands, exits, counts, semantic mutation results and source SHAs are cited above. Those checks remain evidence at their recorded worker revisions; they are not renamed as tests of this final integrated commit. Raw receipts stay in `/Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101`.

On the integrated code snapshot e29eeccef5b553e61d8bfd8725ac54ba46f33e93, `bun run typecheck`, `bun run check:comments`, `bun run lint`, and `npx --no-install backslop lint --require-adapter codex` each exited 0 (logs/ready-typecheck.json, ready-comments.json, ready-biome.json, ready-startup-after-init.json). Full eight gates on this combined ready tree were not run by the owner's stop/handoff instruction.

Fresh read-only Core/Stream/Native composition review at e29eeccef5b553e61d8bfd8725ac54ba46f33e93: 0 Critical/0 Major/0 Minor; 14/14 Core-only source paths match the reviewed Core input, 25/25 Stream/Native-only source paths match the reviewed other input, and the two shared files preserve both code paths. See workers/integration/ready-core-composition-review.md. Prior component reviews and registration-only minor records remain applicable to their stated scopes.

The latest ordinary full workflow before final ready integration, at 7a1f62a5d79a3d0550884e1d106acb8459f8efea, exited 1 with 6/8: Node 1118/1118 and UI 167/167 passed; Bun 1117/1118 failed the recreated-task title check; perf timed out on sample 4 RESTORE after three samples. Diagnostic observer passes are not ordinary qualification and do not refute these failures. DA-156 retains the exact commands, assertions, SHA, receipts and required final cycle.

## Remaining work

DA-156 owns shared stabilization and final quality acceptance. DA-110.6 three uninstrumented full Bun runs, DA-56.9/56.11 final quiet perf verification, DA-155 final writer, absent corpus and other unimplemented/performance/deferred subjects remain open until their own AC are met. New minors remain registration-only. No push, release, tag or package publication is claimed.

**Verification.** Targeted worker checks and independent review are recorded above at their actual SHAs. The ready integration passed typecheck, comment checks, Biome and Backslop lint with exit 0. Shared ordinary eight-gate acceptance remains pending DA-156; the last earlier full workflow was 6/8, exit 1.

**Documentation in the same pass.** Documentation and evidence from the cited implementation commits are retained. This closure updates tracker/archive links and the explicit validation transfer; it introduces no new product contract. Final current-range writer DA-155 remains part of DA-156.
