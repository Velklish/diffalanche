# DA-140 · Update Phase 2 summaries to distinguish implemented capabilities from remaining acceptance

- **Scope:** [09-ml](../../reference/09-ml.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-300
- **Audit priority:** P2
- **Evidence status:** confirmed_static
- **Previous order:** 1030
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context
The roadmap and reference entry point still describe Phase 2 before its implemented features existed. Readers can mistake available commands for planned work.

## Evidence
`docs/ROADMAP.md:9` says `Offline. Not started.` for Phase 2. `docs/reference/README.md:5` says `only the embedding model exists yet`. In contrast, `docs/SPEC.md:3` says Phase 2 has started, and `docs/reference/09-ml.md:3` lists the model, index, suggestions, delivery and symbol index as built.

## Scope
Update the two entry-point summaries against SPEC and the current ML reference. Keep remaining acceptance work visible and keep future generative capabilities separate. Do not declare all of Phase 2 accepted or shipped.

## Acceptance criteria
- Both summaries identify the implemented Phase 2 capabilities consistently with SPEC and 09-ml.
- Implementation status is distinguished from outstanding acceptance and performance evidence.
- Phase 3/4 intent and historical archives remain intact.

## Verification
Proposed, not run: inspect both summaries against docs/SPEC.md and docs/reference/09-ml.md and run documentation lint. No model download or performance run is necessary for this prose-only correction.

Verification status: current source/document hashes match manifest-final.json at 087d3330128f8762ff88b0a9f7a7151dca8db028. This is a confirmed static discrepancy, not new runtime proof. Registration rechecked local source and documentation for this finding; it did not rerun runtime or external-CI evidence.

## Related work and deduplication
DA-84 was an older closed Phase 1 summary correction and does not cover the current Phase 2 drift. DA-123 is a general writer pass, not this specific discrepancy. No live duplicate found.

Regression requirement: the implementation adds or updates a suitable quote guard, targeted assertion or existing lint rule for the corrected current claim. Show that it rejects the pre-change wording; do not infer success from link lint alone.

## Registration boundary

Audit finding PQA-300; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

Documentation currency track. Preserve this card as a separate acceptance subject and keep all original requirements. Coordinate README and CHANGELOG with the safe-content track; root merges shared prose by meaning. Use a durable narrow regression guard that rejects the pre-change normative text and a semantic mutation probe. No runtime or permission contract change is authorized by this documentation correction.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
