# DA-5 · Performance gate in CI

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-3
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 6: a performance test on the synthetic review runs in CI and fails the build on regression; a headless runner checks CPU per frame and long tasks instead of frame rate. [ADR-006](../../adr/adr-006-verification.md) fixes Playwright on headless Chromium.

## Work to do

- Turn the DA-3 harness into `perf/` with a budget table in code: first render 500 ms, zero long tasks and a CPU-per-frame ceiling while scrolling, composer open 50 ms, file jump 50 ms, session switch 100 ms, update after an edit 300 ms. Budgets not yet measurable in Phase 0 (session switch, update after edit) are marked pending and turned on by the UI tasks that make them measurable.
- A GitHub Actions job `perf` that generates the synthetic review, builds the UI, runs the harness three times, and fails when the median of any line exceeds its budget.
- The job prints the measured table in the run summary.
- Add the perf command to `gates` in `backslop.json`.

## Out of scope

- Measuring frame rate; that stays a manual check on a 120 Hz display at phase checkpoints.

## Verification

- CI is green on the DA-3 skeleton.
- A deliberate regression (a synchronous 600 ms loop in the render path on a branch) turns the job red; the branch is deleted afterwards.
- `docs/reference/11-perf.md` describes the harness, the budgets, and how to read the summary.
