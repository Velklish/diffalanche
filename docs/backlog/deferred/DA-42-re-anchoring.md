# DA-42 · Re-anchoring after code edits and orphaned status

- **Scope:** 04-domain, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-12

## Context

`docs/SPEC.md` section 5 Phase 3: after code edits, comments stay on their lines; a comment whose place cannot be found is marked `orphaned` and kept. `docs/design/HANDOFF.md` "Orphaned": three levels — `git blame --reverse` from the base commit to the working tree, then fuzzy match on the stored `lineContent` / `before` / `after`, and only then a model proposal that a human confirms; a comment never moves on its own.

## Work to do

- `src/core/domain/anchors`: on `diff-changed`, for every line comment of the changed files, try blame-based mapping, then fuzzy matching with a similarity threshold; update `line` / `endLine` and the stored context when a unique match is found; otherwise set `status: orphaned` and keep the old anchor.
- Status `orphaned` in the schema (`docs/SPEC.md` section 3, decision 8) and in CLI filters; `reopen` returns an orphaned comment to `open` once re-anchored by hand.
- Scanner warning "N comments lost their anchor in <repo>".

## Out of scope

- The model proposal and the UI (DA-43).

## Verification

- Vitest: inserting five lines above a commented line moves the anchor by five; rewriting the commented line beyond the threshold marks it orphaned; the original anchor text is still in the file.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 3 of `docs/SPEC.md` section 10; depends on Phase 1 and Phase 2 artifacts.
- **Return condition:** DA-32 (Phase 1 acceptance) is archived and the Phase 2 queue is under way; the cut is revisited there.
