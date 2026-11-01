# Result — DA-123 · Writer pass over the backslop v0.20.0 run, batch close

**Closed 2026-11-01.** Completed implementation under the owner-authorized workflow; shared final quality acceptance remains pending DA-156.

- **Date:** 2026-11-01
- **Outcome:** completed implementation; shared quality acceptance pending DA-156
- **Ready integration:** `5f1ba7575f899fff8d08c383f81eaebf99eee82a`; product-code snapshot `e29eeccef5b553e61d8bfd8725ac54ba46f33e93`
- **Publication:** not pushed, released or tagged

## Owner-authorized acceptance boundary

The owner explicitly approved integrating ready implementations and closing their implementation-complete cards before the shared stabilization cycle, then stopping this session. Shared test/performance/integration failures and final eight-gate acceptance are transferred to [DA-156](../../backlog/queue/DA-156-stabilize-ready-integration.md). This is implementation closure, not a claim that all gates pass or that final quality/release acceptance is complete. Original requirements and evidence are retained in task.md.

## Implemented original subjects

### DA-123

Own acceptance evidence: **DA-123**: the *historical* DA-119..122 writer range `8236520^..c79226d` has a document verdict for each of 31 documents and a 14-commit ledger; every new finding got a card. The card's execution plan explicitly separates this from the current-run final writer pass. Its `result.md` and archive are common closure writing after gates. | Docs `ea3e9335` product/doc SHA; registration-only `fd4f9eb7`. `workers/docs/DA-123-ledger.md`, `workers/docs/AC.md`; `workers/docs/handoff.md`: `bun run test -- tests/documentation-contracts.test.ts --reporter=verbose` exit 0, 6/6; 13 configured probes each mutated assertion exit 1/restored 0; `npx --no-install backslop lint --require-adapter codex` exit 0. Exact streams `logs/docs/commands.json`. Review `workers/docs/review-1.md` 0 critical/0 major; separate minor DA-141.1 registered.

## Historical writer ledger

This is the original DA-119..122 historical pass, separate from current-run final writer DA-155.

# DA-123 historical batch-close currency ledger

Input: `8236520021d0ca765d3e0fa8fe652556d7df50d5^..c79226d4f3a27f5e603fe6042563f7eb72cacae9`. This is the DA-119 through DA-122 historical run, not the final currency pass for the 2026-11-01 implementation. Batch-close mode: currency only; no style audit or unrelated restyle. Project precedence: AGENTS.md and GLOSSARY, then Backslop writer/techdoc/humanizer. Source evidence is static, not runtime proof.

## Commit ledger

| Commit | Change and currency verdict |
|---|---|
| `8236520021d0ca765d3e0fa8fe652556d7df50d5` | backlog: DA-119, DA-120, DA-121, DA-122, DA-123 queued — the move to backslop v0.20.0. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `7caba0b25279eb2a5b4e9a3b3d00b465319c681d` | backlog: DA-119.1 filed — the CLI's empty-stderr test inherits the caller's colour variables. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `e6982f660532d952fada80e2093c8a6686f6f05f` | backlog: DA-110.6 filed — test:bun is red on macOS in the watch tree's directory cases. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `b282aa6d45e6b9d0abcfe8989ee3b2a197018dfc` | backlog: DA-110.6 queued — the owner's decision, outside the backslop v0.20.0 run. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `a63e7612bed77a3262ee5879006122294809af80` | backlog: DA-124 queued — one command for the mutation probe, the owner's decision. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `a0488d7bcc9ce0c51c8b4858c68066f8bab9a15e` | DA-119: backslop v0.20.0: pin, hooks for claude, and the layout errors outside documentation. Backslop v0.20.0 pin, local CLI, hooks and process policy; AGENTS, README, ADR-001 and ROLES describe it. No product behavior change. |
| `75c5691c41cda4550c44c616c04345df52d367df` | DA: triage after DA-119. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `a6d2ce838b85f4c4debf3c8cc0f06bc114908a06` | backlog: DA-121.1 filed — ADR-016 calls serve's 742 and 764 MiB a crossing of the 768 MiB ceiling. Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `76f22775c24cfd2e8707f5dbf995fe08261bc3e3` | DA-121: ADRs and the unreleased CHANGELOG state their facts without task numbers. Documentation removes task-only context; no product source behavior change. Document ledger below maps remaining stale claims and retains measurement dates. |
| `3c962f78fd28899ddd7f21a8fcafdfe71119b801` | backlog: DA-121.2 filed — the deleteSession lock race shows EINVAL as well as ENOTEMPTY (hypothesis). Task planning, findings or triage only; no product behavior change, no additional product documentation required. |
| `250461cae6c680c198b9389a3e768269ccbcd9e5` | DA-120: Documentation states its facts without task numbers: README, reference, design, spec, glossary. Documentation removes task-only context; no product source behavior change. Document ledger below maps remaining stale claims and retains measurement dates. |
| `9cb672fdadb587791d4ba37c13290ec3a4fc7058` | DA-122: The whole archive folds into the closed task journal. Archive folding and incoming show references; docs/README, archive README and AGENTS describe journal + retained task body. No product behavior change. |
| `1b133c979a0f85d87e3e70ff026f9db75d659896` | DA-122: open cards point at folded tasks through show. Archive folding and incoming show references; docs/README, archive README and AGENTS describe journal + retained task body. No product behavior change. |
| `c79226d4f3a27f5e603fe6042563f7eb72cacae9` | DA-122: The whole archive folds into the closed task journal. Archive folding and incoming show references; docs/README, archive README and AGENTS describe journal + retained task body. No product behavior change. |

## Every document touched in human-facing writer scope

31 documents. Backlog/archive records are excluded by writer scope; journal mechanics are covered in commit rows and docs/README. Shipped skills were not in historical writer.currency configuration; the apply rationale is independently authorized by DA-142.

| Document | Verdict / code evidence |
|---|---|
| `CHANGELOG.md` | Currency finding DA-123.2: Unreleased index entry defers already implemented npm model delivery; registered, not fixed. Rest is task-reference removal with measurements retained. |
| `README.md` | Tooling pin/hooks/release-writer guidance consistent with configuration. Existing blanket selection claim maps to DA-142; corrected separately. |
| `docs/GLOSSARY.md` | Task-title reference rewritten to its subject; review-document terminology remains consistent with src/server/review.ts. |
| `docs/README.md` | Current ADR rewrite policy and folded journal descriptions agree with AGENTS and local Backslop instructions. |
| `docs/ROADMAP.md` | Existing Phase 2 Not started maps to DA-140; corrected separately. Phase 3/4 intent retained. |
| `docs/ROLES.md` | Generated worker/approver and quote-before responsibilities agree with installed Backslop roles. |
| `docs/SPEC.md` | Dated paced/unpaced explanation preserved. Existing in-process and blanket selection claims map to DA-141/142; corrected separately. |
| `docs/adr/adr-001-process.md` | Local CLI pin, rewrite-in-place ADR policy and journal folding match config/package and Backslop contract. |
| `docs/adr/adr-004-agent-contract.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-007-execution-model.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-008-diff-rendering-verdict.md` | DA-123.1 registers current-consequence future budget forecasts; dated renderer spike measurements retained. |
| `docs/adr/adr-009-unit-suite-on-bun.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-010-review-task-scope.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-011-comment-length.md` | DA-123.1 registers future sweep claim; gate exists in package scripts and CI. |
| `docs/adr/adr-012-git-trust-model.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-013-perf-gate-off-ci.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-014-embedding-model-and-npm-delivery.md` | Existing process-placement and delivery guidance maps to DA-141; corrected separately; dated model/runtime measurements retained. |
| `docs/adr/adr-015-symbol-index-binding.md` | Task-reference removal preserves the existing decision, historical conditions and measurements; no runtime code changed in input. No new currency finding in changed passage. |
| `docs/adr/adr-016-model-in-a-process-of-its-own.md` | 742/764/768 arithmetic maps to separate DA-121.1; corrected using show34.2 original record. Other dated numbers retained. |
| `docs/design/HANDOFF.md` | Existing renderer/storage/Escape contradictions map to DA-139; corrected separately; HTML prototypes untouched. |
| `docs/reference/02-git.md` | Task-reference removal preserves read-only Git trust and symlink target description; src/core/git/index.ts:180-184 backs target via readlink. Safe-reads owns further corrections. |
| `docs/reference/03-storage.md` | Task-reference removal preserves schema/locking/error contracts; src/core/storage/index.ts:79-87 backs directory layout. |
| `docs/reference/04-domain.md` | Task-reference removal preserves human-only delete, literal scope and severity-source contracts; sessions.ts and scope.ts remain unchanged by range. |
| `docs/reference/05-watcher.md` | Existing stale pending update-budget claim was corrected to enforcement; perf/budgets.ts:40 sets measured updateMs 300. Watcher owns further current native notes. |
| `docs/reference/06-cli.md` | Corrected named-window live events agree with watcher/index.ts:294-295 followedSessions. Other edits remove task references without changing command contract. |
| `docs/reference/07-server.md` | Symlink change-set prose agrees with git/index.ts:180-184; route repository-symlink distinction remains explicit. Other edits preserve dated cache/live evidence; safe-reads owns current route corrections. |
| `docs/reference/08-ui.md` | Named-task watcher correction agrees with src/ui/live.ts:114-117 and watcher followedSessions. Existing destructive count maps to separate attached DA-58.5; selection row corrected in DA-142. |
| `docs/reference/09-ml.md` | Task-reference removal and built-composer/future-generative distinction agree with source modules; child-process guidance already current. Historical perf numbers preserved. |
| `docs/reference/10-skills.md` | Task-reference removal leaves severity-confirmation and package skill delivery unchanged; shipped apply skill retains explicit --review. |
| `docs/reference/11-perf.md` | Task-reference removal retains dates, versions, sample conditions and unresolved budgets. CI assertion wording follows Windows verification prose; no perf rerun claimed. |
| `docs/reference/README.md` | Existing only-model summary maps to DA-140; corrected separately. Export/frame-table check descriptions preserved. |

## Findings and boundaries

- Registered DA-123.1 (minor), ADR-008/ADR-011 future consequences of already completed work.
- Registered DA-123.2 (minor), Unreleased index entry deferring completed delivery.
- Existing records mapped rather than duplicated: DA-139 and attached source DA-58.5; DA-140; DA-141; DA-142; DA-121.1. Their fixes are separate candidates, not fixes performed under DA-123.
- The 35% phrase in 11-perf is explicitly attributed to the historical nine-point characterization; no new measurement or percentage is asserted by this pass.
- No code-changing product commit exists in this historical input; the only test edit is tests/ci-names.test.ts expected documentation wording.
- No live browser/model/download/performance verification in this writer pass. All eight integration gates and fresh review remain root acceptance work.


## Verification and review limits

Own targeted commands, exits, counts, semantic mutation results and source SHAs are cited above. Those checks remain evidence at their recorded worker revisions; they are not renamed as tests of this final integrated commit. Raw receipts stay in `/Users/kim.p/.bb/thread-storage/diffalanche-execution-20261101`.

On the integrated code snapshot e29eeccef5b553e61d8bfd8725ac54ba46f33e93, `bun run typecheck`, `bun run check:comments`, `bun run lint`, and `npx --no-install backslop lint --require-adapter codex` each exited 0 (logs/ready-typecheck.json, ready-comments.json, ready-biome.json, ready-startup-after-init.json). Full eight gates on this combined ready tree were not run by the owner's stop/handoff instruction.

Fresh read-only Core/Stream/Native composition review at e29eeccef5b553e61d8bfd8725ac54ba46f33e93: 0 Critical/0 Major/0 Minor; 14/14 Core-only source paths match the reviewed Core input, 25/25 Stream/Native-only source paths match the reviewed other input, and the two shared files preserve both code paths. See workers/integration/ready-core-composition-review.md. Prior component reviews and registration-only minor records remain applicable to their stated scopes.

The latest ordinary full workflow before final ready integration, at 7a1f62a5d79a3d0550884e1d106acb8459f8efea, exited 1 with 6/8: Node 1118/1118 and UI 167/167 passed; Bun 1117/1118 failed the recreated-task title check; perf timed out on sample 4 RESTORE after three samples. Diagnostic observer passes are not ordinary qualification and do not refute these failures. DA-156 retains the exact commands, assertions, SHA, receipts and required final cycle.

## Remaining work

DA-156 owns shared stabilization and final quality acceptance. DA-110.6 three uninstrumented full Bun runs, DA-56.9/56.11 final quiet perf verification, DA-155 final writer, absent corpus and other unimplemented/performance/deferred subjects remain open until their own AC are met. New minors remain registration-only. No push, release, tag or package publication is claimed.

**Verification.** Targeted worker checks and independent review are recorded above at their actual SHAs. The ready integration passed typecheck, comment checks, Biome and Backslop lint with exit 0. Shared ordinary eight-gate acceptance remains pending DA-156; the last earlier full workflow was 6/8, exit 1.

**Documentation in the same pass.** Documentation and evidence from the cited implementation commits are retained. This closure updates tracker/archive links and the explicit validation transfer; it introduces no new product contract. Final current-range writer DA-155 remains part of DA-156.
