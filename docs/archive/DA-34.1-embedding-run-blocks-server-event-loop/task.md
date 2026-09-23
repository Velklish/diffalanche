# DA-34.1 · Embedding in the server holds its event loop for the length of every run

- **Order:** 635
- **Scope:** [09-ml](../../reference/README.md)
- **Created:** 2026-09-23
- **Cost:** major
- **Dependencies:** DA-33

## Context

Finding discovered while working on DA-33, for the tasks that embed inside the
server (DA-34's incremental update and `index rebuild`, DA-35's `suggest`).
`onnxruntime-node` 1.30.0 runs a session synchronously on the calling thread:
`dist/backend.js` wraps the native `run` in a `setImmediate` and resolves with
its result, so no other callback of the process runs until the model is done.
ADR-014 records it:

<!-- quote:../../adr/adr-014-embedding-model-and-npm-delivery.md -->
- **`session.run` holds the event loop.** `dist/backend.js` of 1.30.0 runs the
  native session synchronously inside a `setImmediate`, so a run blocks the
  thread that called it for as long as it takes.
<!-- /quote -->

`src/core/ml/embed` runs one text per run, which bounds a stall to one text: a
median of 8–27 ms per 31-token comment on a busy machine (ADR-014). A rebuild of
the synthetic review's 200 comments is 200 such stalls back to back, and a
512-token comment is one longer stall. Whether that breaks a budget of
`docs/SPEC.md` section 6 — an update after an edit within 300 ms, switching
sessions within 100 ms — is **not measured**; it is the hypothesis this finding
asks DA-34 to settle.

## Work to do

- Measure the event-loop delay of the server while it embeds the synthetic
  review's 200 comments, on a quiet machine, against the section 6 budgets.
- If it is over: yield between texts, or move the model into a worker thread
  (`node:worker_threads`, which Bun implements too) and measure again.

## Out of scope

- The choice of runtime (ADR-014).

## Verification

- The perf gate stays green with an index rebuild running during the
  measurement, or the budget that fails is named with its number.
