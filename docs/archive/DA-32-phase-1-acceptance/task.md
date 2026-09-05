# DA-32 · Phase 1 acceptance

- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-28, DA-29, DA-30, DA-31
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 10, Phase 1: the acceptance criteria and the performance budget table, with 120 fps verified by hand on a 120 Hz display. Closing this task returns the Phase 2 tasks from `deferred/` to the queue ([ADR-007](../../adr/adr-007-execution-model.md)).

## Work to do

- Walk every acceptance criterion of section 10 on a fixture root and on the owner's real multi-repository workspace; record each with the command or screenshot that proves it.
- Run the perf harness locally and scroll the synthetic review on a 120 Hz display; record the observed frame rate and any dropped frames.
- Check the budget table of section 6 line by line against the CI summary of the release candidate.
- Revisit the Phase 2 cut: update task files in `deferred/` with what Phase 1 changed, then move DA-33 to DA-41 to the queue in dependency order.
- Tag `v0.1.0` through the release pipeline.

## Out of scope

- Fixing what the walk finds: each finding becomes `new --parent 32` and is scheduled.

## Verification

- `result.md` holds the filled criteria list, the frame-rate note, the budget table, and the release link.
- `status` shows DA-33 to DA-41 in the queue and nothing from Phase 2 in `deferred/`.
