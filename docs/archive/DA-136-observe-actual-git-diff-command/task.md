# DA-136 · Observe diff-index in the configuration-refusal regression test

- **Scope:** [02-git](../../reference/02-git.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-104
- **Audit priority:** P2
- **Evidence status:** confirmed_static
- **Previous order:** 1010
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The test claiming that an unreadable repository configuration never reaches a diff logs the wrong Git subcommand. Its negative assertion can pass even when production diff-index is called.

## Evidence

- tests/git.test.ts:834 writes calls.log only for the exact argv token "diff"; :841-855 claims never reaches the diff and asserts an empty log.
- src/core/git/run.ts:172-183 executes "diff-index" (the token is at :174), not "diff". This is a static blind assertion; the audit did not demonstrate a production refusal bug.

## Work to do

- Observe the actual inert diff-index operation, with a positive control or bounded mutation proving that an attempted diff reaches the recorder.
- Retain the useful no-base, empty-files, and warning assertions. Keep shim cleanup reliable on assertion failures.

## Acceptance criteria

- The recorder detects the current production diff-index command.
- An intentionally reached diff-index makes the never-diff assertion fail; normal config refusal still satisfies it.
- The existing product-output checks remain.

## Verification

- `node node_modules/vitest/vitest.mjs run --project unit tests/git.test.ts --no-cache --configLoader runner` — notRun. Proposed implementation verification; all 379 audited text files are unchanged, so no broad suite was repeated for registration.
- `Run a bounded positive-control/mutation check of the refusal recorder` — notRun

## Deduplication

No matching current backlog card. Cost is major because the claimed refusal path is unchecked, even though the fix is small.

## Registration boundary

Audit finding PQA-104; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
