# DA-126 · Do not submit a hidden comment draft from an overlay

- **Scope:** [08-ui](../../reference/08-ui.md)
- **Created:** 2026-11-01
- **Dependencies:** none
- **Cost:** major
- **Audit finding:** PQA-200
- **Audit priority:** P1
- **Evidence status:** confirmed

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
