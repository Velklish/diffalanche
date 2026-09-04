# DA-47 · Note to comment in the reviewer's own style

- **Scope:** 08-ui, 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-36, DA-46

## Context

`docs/SPEC.md` section 5 Phase 4: the user turns a short note into a comment written in their own style; "in your style" is retrieval of similar past comments used as examples (decision 10).

## Work to do

- `POST /api/rewrite`: take the note and the anchor context, retrieve the nearest past comments as examples, generate a comment with the model, return it with the examples used.
- Composer: a `Rewrite` action that replaces the field's text with the generation, keeps the note in an undo slot, and shows which examples were used.

## Out of scope

- Generating comments without a note.

## Verification

- Playwright with the model present: a three-word note becomes a full comment; undo restores the note; with the model absent the action shows the `model pull` hint.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 4 of `docs/SPEC.md` section 10; depends on the embedding index and the model runtime from Phase 2.
- **Return condition:** DA-32 (Phase 1 acceptance) is archived and the Phase 2 queue is under way; the cut is revisited there.
