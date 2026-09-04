# DA-43 · Orphaned comments in the UI with model proposal

- **Scope:** 08-ui, 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-36, DA-42

## Context

`docs/design/HANDOFF.md` section 3 (orphaned card: warning border, struck-through lost anchor, `Ask the model`, `Find new place`, `To file`; the model proposal block with candidate line, confidence, `Attach` / `Not this`) and "Orphaned" in interactions: the model returns a line, a candidate, and a confidence; the human confirms.

## Work to do

- Server: `POST /api/comments/:id/reanchor/propose` — embed the stored anchor context and the comment, score candidate lines of the file's current content, return the best with confidence and a one-line explanation; `POST /api/comments/:id/reanchor` with a chosen line.
- UI: the orphaned card states, the pulsing "model is searching" state, manual pick mode ("choose a line" in the status bar, next click attaches), `To file`.
- Activity event and toast on re-anchoring.

## Out of scope

- Automatic attachment without confirmation (forbidden by the handoff).

## Verification

- Playwright: an orphaned comment on the fixture shows the card; `Ask the model` proposes the moved line with confidence; `Attach` updates `line` in `list --json` and the status returns to `open`; `Find new place` then a click attaches to the clicked line.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 3 of `docs/SPEC.md` section 10; depends on Phase 1 and Phase 2 artifacts.
- **Return condition:** DA-32 (Phase 1 acceptance) is archived and the Phase 2 queue is under way; the cut is revisited there.
