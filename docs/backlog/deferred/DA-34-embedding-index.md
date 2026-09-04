# DA-34 · Embedding index over all sessions

- **Scope:** 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-33

## Context

`docs/SPEC.md` section 7: next to the sessions live the `current` pointer and the embedding index over all sessions; section 8: `index rebuild`. Suggestions and insights both read the index.

## Work to do

- `src/core/ml/index`: a flat vector store in the data directory (`index/`) keyed by comment id and session, with the comment's severity and text; incremental update on every comment write through the storage layer; full rebuild command.
- Nearest-neighbour search by cosine similarity with a session filter; brute force is fine up to tens of thousands of comments — record the measured size where it stops being fine.
- `index rebuild` CLI command and `index status`.

## Out of scope

- Ranking for suggestions (DA-35).

## Verification

- Vitest: writing a comment updates the index; `index rebuild` from scratch on the synthetic review yields the same vectors; a query returns the known nearest comment first.
- Search over 10 000 vectors returns within 50 ms on the development machine.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.
