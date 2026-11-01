# DA-146 · Automatically check that the reading probe and its CSS and browser-test copies agree

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** minor
- **Audit finding:** PQA-304
- **Audit priority:** P3
- **Evidence status:** confirmed_static
- **Previous order:** 1160
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context
The reference instructs maintainers to move four coordinate copies together manually. They all equal 100 today; the gap is missing deterministic enforcement, not a currently observed geometry defect. A future partial change can make browser checks inspect a different pixel from the application.

## Evidence
`docs/reference/08-ui.md:534–544` explicitly lists one constant and three handwritten copies that must move together. They are `src/ui/reveal.ts:12` PROBE_Y, `src/ui/styles.css:752` scroll-margin-top, `e2e/sidebar.spec.ts:14` elementFromPoint y, and `e2e/live.spec.ts:113` probe. Existing behavioral checks hold their own coordinate copies; the audit found no assertion linking these declarations.

## Scope
Use the existing unit-test/check infrastructure to enforce agreement, or a small pure shared value if it is simpler locally. Avoid importing reveal.ts into browser tests if that pulls store/DOM dependencies. Do not build a general geometry framework, hard-code an assertion that the value must always be 100, or remove behavioral browser coverage.

## Acceptance criteria
- The normal deterministic unit/check gate fails when any one consumer disagrees or its declaration cannot be read.
- Changing only PROBE_Y makes the check fail and identifies the disagreeing paths.
- The original consistent values pass; a consistent change of all consumers also passes.
- Existing browser reading-position checks remain; imports do not require DOM initialization for the consistency check.

## Verification
Proposed, not run: targeted new unit consistency check; controlled mutation of PROBE_Y alone; consistent-value case; existing sidebar/live browser checks when implementing. Record exact commands, mutation restoration and exit codes in the implementation receipt.

Verification status: current source/document hashes match manifest-final.json at 087d3330128f8762ff88b0a9f7a7151dca8db028. This is a confirmed static discrepancy, not new runtime proof. Registration rechecked local source and documentation for this finding; it did not rerun runtime or external-CI evidence.

## Related work and deduplication
No dedicated live backlog task covers this synchronization obligation. Human visual design decisions and approval are outside the automation scope.

## Registration boundary

Audit finding PQA-304; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

Verification hygiene track owns only the four original fixture lifetimes, removal of the arithmetic skeleton, and a deterministic check linking the four existing reading-coordinate declarations. Keep the runtime smoke and browser behavior assertions. Do not introduce a fixture or geometry framework; source coordinates and UI behavior stay as specified. Prove owned-path cleanup after success and controlled failure without sweeping shared temporary directories. Keep separate original DA-143 and DA-144 outcomes; no new minor fixes.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
