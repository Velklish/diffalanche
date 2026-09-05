# DA-34 · Embedding index over all sessions

- **Order:** 340
- **Scope:** 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-33

## Context

`docs/SPEC.md` section 7: next to the sessions live the `current` pointer and the embedding index over all sessions; section 8: `index rebuild`. Suggestions and insights both read the index.

## Work to do

- `src/core/ml/index`: a flat vector store in the data directory (`index/`) keyed by comment id and session, with the comment's severity and text; incremental update on every comment write through the storage layer; full rebuild command.
- Nearest-neighbour search by cosine similarity with a session filter; brute force is fine up to tens of thousands of comments — record the measured size where it stops being fine.
- `index rebuild` CLI command and `index status`.

## What Phase 1 changed

Phase 1 fixed the storage and the write path this index hangs off. Every comment write goes through `src/core/domain` under the session lock (`withLock`, [03-storage.md](../../reference/03-storage.md)), and the server announces it on the live stream as `comment-added` / `reply-added` ([07-server.md](../../reference/07-server.md)) — the incremental update has two places to attach, the domain write or the event bus, and the choice is part of this task. Sessions are never deleted yet (DA-40); the `current` pointer and the review directories are documented in `03-storage.md`, and the glossary carries *review session* and *review document*.

## Out of scope

- Ranking for suggestions (DA-35).

## Verification

- Vitest: writing a comment updates the index; `index rebuild` from scratch on the synthetic review yields the same vectors; a query returns the known nearest comment first.
- Search over 10 000 vectors returns within 50 ms on the development machine.

