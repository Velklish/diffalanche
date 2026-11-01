# DA-130 · Make the first-run CLI example match the selected base

- **Scope:** [08-ui](../../reference/08-ui.md); [06-cli](../../reference/06-cli.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-201
- **Audit priority:** P2
- **Evidence status:** confirmed
- **Previous order:** 960
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

The first-run screen says the displayed terminal command does the same as Create, but the default form selects head while the command specifies branch.

## Evidence

Source:

- `src/ui/components/FirstRun.tsx:83-85`
- `src/ui/store.ts:741,750-764`
- `e2e/empty.spec.ts:64`

Observed: The isolated first-run screenshot shows head selected and the command ending in --base branch.

Limits: No shell execution of the displayed command was performed.

## Work to do

Generate a truthful CLI example from the actual selected base and name. Represent user-controlled arguments safely for the supported shell, or present a clearly labelled non-copyable example if exact shell representation cannot be guaranteed.

## Acceptance criteria

- For head, default branch, named branch and ref, the displayed command describes the same base as the Create request.
- A name or ref with shell-significant characters cannot turn a copied example into unintended shell syntax.
- The example remains understandable before a name is entered.

## Verification

Proposed implementation checks, not run during registration:

- Extend e2e/empty.spec.ts to compare the displayed base and captured Create payload for each mode; test shell-sensitive inputs where a copyable command is shown.
- Run bun run test:ui and the repository gates after implementation.

## Registration boundary

Audit finding PQA-201; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

UI interaction track owns keyboard overlays, first-run/base selection and global search for this group. Keep each card as a separate verdict and acceptance subject. Run the installed Impeccable context loader before src/ui edits, preserve PRODUCT/DESIGN and desktop minimum, and close touched surfaces with audit/polish and browser evidence. Coordinate reference 08 by section with the completed documentation track. Add deterministic regression coverage before fixes; do not infer accessibility user impact from static markup alone. No broader redesign or deferred UI features.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
