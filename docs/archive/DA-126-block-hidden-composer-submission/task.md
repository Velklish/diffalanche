# DA-126 · Do not submit a hidden comment draft from an overlay

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-200
- **Audit priority:** P1
- **Evidence status:** confirmed
- **Previous order:** 920
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

A reviewer can keep a comment draft open while using global search or another overlay. The keyboard shortcut must belong to the visible surface.

## Evidence

Source:

- `src/ui/keys.ts:61-65,72`
- `e2e/keyboard.spec.ts:204-224`

Observed: On the isolated synthetic fixture, Meta+Enter in global search saved the draft while the dialog remained open; the browser keyboard event was followed by comments.json readback.

Limits: Browser automation on the audit snapshot, not a physical keyboard; see ui-report.md PQA-200.

## Work to do

Gate composer submission while an overlay is open. Preserve submission in the composer and the existing Escape ladder.

## Acceptance criteria

- With a nonempty draft and global search or another overlay open, Meta+Enter and Ctrl+Enter do not write a comment and the draft remains intact.
- After closing the overlay, the shortcut submits the draft once, with its original anchor and severity.

## Verification

Proposed implementation checks, not run during registration:

- Add a focused browser regression in e2e/keyboard.spec.ts with disk or CLI readback; include both modifier keys.
- Run bun run test:ui and the repository gates after implementation.

## Registration boundary

Audit finding PQA-200; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

## Next step

The owner reviews and approves this item individually before it is queued for implementation. Creating this card does not authorize product changes.

## Execution plan

UI interaction track owns keyboard overlays, first-run/base selection and global search for this group. Keep each card as a separate verdict and acceptance subject. Run the installed Impeccable context loader before src/ui edits, preserve PRODUCT/DESIGN and desktop minimum, and close touched surfaces with audit/polish and browser evidence. Coordinate reference 08 by section with the completed documentation track. Add deterministic regression coverage before fixes; do not infer accessibility user impact from static markup alone. No broader redesign or deferred UI features.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
