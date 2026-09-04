# DA-33 · Embedding model runtime and delivery decision

- **Scope:** 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-16

## Context

`docs/SPEC.md` section 3, decision 10: a multilingual embedding model of about 118M parameters (about 120 MB in int8) ships with the tool, works offline with nothing to install, and runs in the server process so the CLI gets suggestions too. Open question 1 of section 12: npm delivery — download on first run or a separate package. The binary embeds the model.

## Work to do

- Pick the model and the inference runtime that runs under both Node and Bun (candidates: an ONNX runtime with int8 weights; measure load time and memory).
- `src/core/ml/embed`: load once per process, embed a batch of texts, cache the model in a user-level directory for the npm channel.
- Decide npm delivery and record it as an ADR closing the spec's open question 1.
- `model status` reports the embedding model's location and version.

## Out of scope

- The index (DA-34); the generative model (DA-46).

## Verification

- Embedding 200 comments takes under one second after warm-up on the development machine; memory stays under a ceiling recorded in the ADR.
- The same embedding vector comes out under Node and Bun for the same text (cosine similarity above 0.999).
- With the network disabled and the model cached, the server starts and embeds.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.
