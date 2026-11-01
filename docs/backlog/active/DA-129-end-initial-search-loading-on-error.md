# DA-129 · End text-search loading when the current request fails

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-205
- **Audit priority:** P2
- **Evidence status:** confirmed_code
- **Previous order:** 950
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The first page of text search can fail while the user searches across working trees. A failed search must be distinguishable from a search still in progress.

## Evidence

Source:

- `src/ui/components/GlobalSearch.tsx:122-128,262-267,301-309`
- `e2e/search-text.spec.ts:59-80`
- `e2e/symbols.spec.ts:70-79`

Observed: Non-OK responses and fetch errors yield null, leaving the initial request in loading. Next-page failure has a retry test; symbol-search errors are displayed.

Limits: The first-page error path was established by code inspection, not runtime injection.

## Work to do

Distinguish cancellation of an obsolete query from failure of the current query; stop loading and expose a useful failure/retry while retaining hits from other search sources.

## Acceptance criteria

- HTTP 500 and network rejection of the current first-page request end loading and make the failure visible.
- Changing the query aborts or ignores the prior request without showing its failure for the new query.
- Other matching results and the existing next-page retry remain available.

## Verification

Proposed implementation checks, not run during registration:

- Add targeted Playwright coverage in e2e/search-text.spec.ts using intercepted HTTP 500, network rejection, query change and retry.
- Run bun run test:ui and the repository gates after implementation.

## Registration boundary

Audit finding PQA-205; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

UI interaction track owns keyboard overlays, first-run/base selection and global search for this group. Keep each card as a separate verdict and acceptance subject. Run the installed Impeccable context loader before src/ui edits, preserve PRODUCT/DESIGN and desktop minimum, and close touched surfaces with audit/polish and browser evidence. Coordinate reference 08 by section with the completed documentation track. Add deterministic regression coverage before fixes; do not infer accessibility user impact from static markup alone. No broader redesign or deferred UI features.
