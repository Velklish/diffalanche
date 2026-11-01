# DA-141 · Document the current child-process embedding boundary in SPEC and ADR-014

- **Scope:** [09-ml](../../reference/09-ml.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-301
- **Audit priority:** P2
- **Evidence status:** confirmed_static
- **Previous order:** 1040
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context
Current architecture guidance still tells a future implementer to host embedding inside the server even though both server and command callers now spawn the model in a child process. This obscures the memory and event-loop isolation boundary.

## Evidence
`docs/SPEC.md:33` says the model runs in the server process. `docs/adr/adr-014-embedding-model-and-npm-delivery.md:250–253` retains in-process guidance and a future worker suggestion. `src/core/ml/embed/open.ts:58–63,74–89` uses startSpawnedEmbedder; `spawned.ts:60–64` spawns process.execPath. `docs/reference/09-ml.md:386` and accepted `docs/adr/adr-016-model-in-a-process-of-its-own.md` describe the child-process design.

## Scope
Correct SPEC and rewrite the stale process-placement consequences of ADR-014 in place to describe the current child-process boundary. Keep ADR-014's still-applicable model, runtime and cache decisions distinct from ADR-016's process-placement decision. Follow the project's current-decision policy: do not introduce a superseded status or a revised-by chain. Retain measurements that still support the current decisions with their dates and versions; Git preserves obsolete instructions and measurements.

## Acceptance criteria
- Current SPEC instructions place embedding in a child process for server and command callers.
- ADR-014 no longer instructs in-process embedding or describes the chosen child process as future work; its remaining decisions are consistent with ADR-016.
- Still-applicable measurements retain their dates and versions and are not rewritten as current results. Obsolete instructions do not remain normative.

## Verification
Proposed, not run: compare edited instructions with open.ts, spawned.ts, ADR-016 and 09-ml; run documentation lint. Model-heavy tests are not required for a prose-only correction backed by unchanged call sites.

Verification status: current source/document hashes match manifest-final.json at 087d3330128f8762ff88b0a9f7a7151dca8db028. This is a confirmed static discrepancy, not new runtime proof. Registration rechecked local source and documentation for this finding; it did not rerun runtime or external-CI evidence.

## Related work and deduplication
DA-121.1 tracks the separate 742/764/768 MiB arithmetic inconsistency in ADR-016 and must remain separate. No live task covers the stale process-placement instructions.

Regression requirement: the implementation adds or updates a suitable quote guard, targeted assertion or existing lint rule for the corrected current claim. Show that it rejects the pre-change wording; do not infer success from link lint alone.

## Registration boundary

Audit finding PQA-301; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

Documentation currency track. Preserve this card as a separate acceptance subject and keep all original requirements. Coordinate README and CHANGELOG with the safe-content track; root merges shared prose by meaning. Use a durable narrow regression guard that rejects the pre-change normative text and a semantic mutation probe. No runtime or permission contract change is authorized by this documentation correction.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
