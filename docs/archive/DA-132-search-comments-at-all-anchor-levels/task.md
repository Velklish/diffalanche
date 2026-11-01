# DA-132 · Search comments at every anchor level and open their thread

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-203
- **Audit priority:** P2
- **Evidence status:** confirmed
- **Previous order:** 980
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The specification says global search finds comments of the current review. The current implementation deliberately omits comments without both repository and file anchors.

## Evidence

Source:

- `docs/SPEC.md:78`
- `docs/reference/08-ui.md:1819-1821`
- `src/ui/search.ts:93-94`
- `tests/ui-search.test.ts:113-116`

Observed: In an isolated synthetic fixture, a review-level comment was written, but an exact search for its unique body returned no results.

Limits: Repository-level omission is established from the same guard, not separately reproduced in the browser.

## Work to do

Add search results and useful preview/navigation for review and repository anchors as well as existing file and line anchors. Choosing any comment result navigates to its thread. Preserve existing file and line search and ordering.

## Acceptance criteria

- Search finds matching comments at review, repository, file and line anchor levels in the current review.
- Choosing each comment result navigates to the corresponding thread, including comments without a file preview.
- Existing file and line search ordering and navigation remain covered.
- The specification, reference, UI and tests reflect the owner decision; replace the existing exclusion assertion with coverage of all anchor levels.

## Verification

Proposed implementation checks, not run during registration:

- Run npx --no-install vitest run tests/ui-search.test.ts and add a targeted Playwright scenario covering review, repository, file and line comments and navigation to each thread.
- Run bun run test:ui and the repository gates after implementation.

## Owner decision — 2026-11-01

2026-11-01: Global search must find comments at all anchor levels (review, repository, file and line) and navigate to the selected thread.

## Registration boundary

Audit finding PQA-203; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

UI interaction track owns keyboard overlays, first-run/base selection and global search for this group. Keep each card as a separate verdict and acceptance subject. Run the installed Impeccable context loader before src/ui edits, preserve PRODUCT/DESIGN and desktop minimum, and close touched surfaces with audit/polish and browser evidence. Coordinate reference 08 by section with the completed documentation track. Add deterministic regression coverage before fixes; do not infer accessibility user impact from static markup alone. No broader redesign or deferred UI features.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
