# DA-46 · Generative model runtime: model pull and status

- **Scope:** 09-ml, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-33

## Context

`docs/SPEC.md` section 3, decision 10: a generative 0.5B model (about 400 MB quantized) downloaded on demand with `model pull`; section 8: `model pull`, `model status`. No fine-tuning.

## Work to do

- Pick the model and a runtime that runs under Node and Bun with CPU inference; measure tokens per second and memory on the development machine.
- `src/core/ml/generate`: load on first use, prompt with retrieved examples, stream tokens; `model pull` with checksum and progress; `model status`.
- Clear behaviour when the model is absent: features that need it show the pull command.

## Out of scope

- The features themselves (DA-47, DA-48).

## Verification

- `model pull` downloads once and verifies; a 60-token generation completes within a time recorded in the reference; `model status` reports both models.

## Deferred

- **Deferred:** 2026-09-29
- **Reason:** The model is downloaded from huggingface.co, which the cloud session's network refuses, and the card measures tokens per second and memory on the development machine.
- **Return condition:** A session on the development machine, or a cloud environment whose network allows huggingface.co and its CDN.
