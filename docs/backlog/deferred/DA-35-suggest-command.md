# DA-35 · suggest command and API

- **Scope:** 09-ml, 06-cli, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-34

## Context

`docs/SPEC.md` section 8: `suggest --body <text> [--json]` returns similar past comments and a likely severity; section 3, decision 10: no fine-tuning — "in your style" is retrieval of past comments.

## Work to do

- `src/core/ml/suggest`: embed the text, take the k nearest comments across sessions, return them with similarity and source (session, file, line); severity proposal by weighted vote of the neighbours with a confidence.
- CLI `suggest` and `GET /api/suggest?body=` for the composer; results within 100 ms after the model is warm.

## Out of scope

- The composer UI (DA-36).

## Verification

- On the synthetic review with clustered comment texts, `suggest` for a paraphrase returns a comment of the same cluster first and proposes its severity.
- Response time measured in a test stays under 100 ms for a warm model.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.
