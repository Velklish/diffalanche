# DA-48 · insights command: recurring findings

- **Scope:** 09-ml, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-34, DA-46

## Context

`docs/SPEC.md` section 5 Phase 4 and section 8: `insights [--since <date>] [--json]` — a report of recurring findings across all sessions with labelled clusters. `docs/design/HANDOFF.md` section 11 "Data": cluster names come from the model, counts are exact.

## Work to do

- `src/core/ml/insights`: cluster comment embeddings from the index within the period (a density or agglomerative method with a similarity threshold; record the choice and the threshold in the reference), count occurrences per session and per repository, compute the trend across sessions and the severity mix, name each cluster with the generative model from its examples.
- CLI `insights` with a text report and `--json` in the shape the screen needs (DA-49).

## Out of scope

- The screen (DA-49).

## Verification

- On the synthetic review with seeded repeated comment families, `insights --json` returns the families as clusters with exact counts; labels are non-empty strings; counts match a direct query of the comments.

## Deferred

- **Deferred:** 2026-09-29
- **Reason:** Depends on DA-46, which is deferred.
- **Return condition:** DA-46 is archived.
