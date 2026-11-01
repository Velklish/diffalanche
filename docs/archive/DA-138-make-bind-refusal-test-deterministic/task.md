# DA-138 · Make the listen-permission test deterministic and close any successful server

- **Scope:** [06-cli](../../reference/06-cli.md); [07-server](../../reference/07-server.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major (hypothesis)
- **Audit finding:** PQA-107
- **Audit priority:** P2
- **Evidence status:** hypothesis
- **Previous order:** 1080
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The CLI test assumes that every non-root process is forbidden to bind port 1. Some supported environments allow it. In that case the supposedly failing in-process serve call may start a real server without exposing a handle for test cleanup.

## Evidence

- tests/cli.test.ts:691-696 skips only getuid()==0, then calls serve --port 1 and expects exit 1.
- A non-root identity alone does not prove EACCES on a privileged port. The current audit test run passed, so the allowed-bind failure/leak path remains a platform hypothesis, not an observed leak.

## Work to do

- Use an existing deterministic ListenError/EACCES injection seam, or a small isolated child with an explicit capability result and awaited termination.
- Ensure every successfully opened server/watch resource is closed even when the permission expectation is wrong. Do not change host port policy or require root.

## Acceptance criteria

- The intended EACCES reporting branch is verified independently of the host privileged-port policy.
- A host permitting non-root bind cannot hang or leak the test server.
- The permission diagnostic and exit status remain asserted; any capability skip names its measured reason.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/cli.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Exercise allowed-bind and EACCES outcomes with owned deterministic fixtures/children and awaited cleanup` — notRun

## Deduplication

DA-117.2 covers chmod tests skipped under root; this is the distinct assumption that non-root port 1 must fail.

## Registration boundary

Audit finding PQA-107; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

CLI reliability track owns output stream error handling and focused CLI/listen reporting regressions. Reproduce each hypothesis before choosing a production change. Use a deterministic existing ListenError seam or owned child fixture, close every resource on both outcomes, and preserve real error diagnostics. Isolate color environment only in the owned stderr fixture; retain negative controls for other output errors. Keep separate original DA-115.2 and DA-119.1 outcomes and preserve the historical before quote. No host port-policy changes or deferred implementation.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
