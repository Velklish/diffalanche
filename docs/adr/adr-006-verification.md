# ADR-006: Vitest, Node and Bun smoke matrix, Playwright performance gate

**Status:** Accepted
**Revised by [ADR-009](adr-009-unit-suite-on-bun.md):** the unit suite runs on Bun's runtime as well, not only the smoke matrix.
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

The spec asks for CI that is green on Node and Bun, binaries for six targets, and a performance test on a synthetic review that fails the build on regression (sections 6 and 10). `bun test` does not run on Node, and a headless browser cannot measure a frame rate. Evidence: `docs/SPEC.md` sections 6 and 10.

## Options

- **Unit runner → Vitest / `bun test` / `node:test`.** Vitest runs under Node and through `bunx` under Bun and tests React components. `bun test` never executes under Node. `node:test` runs under both but lacks component testing.
- **Runtime parity → unit tests on both / smoke on both.** Running the whole unit suite twice is slow and mostly redundant; a smoke scenario that starts the server, creates a session, writes and lists a comment catches runtime differences where they matter.
- **Frame rate → measure in CI / measure by hand.** CI can count long tasks and CPU time per frame; 120 fps needs a 120 Hz display and eyes.

## Decision

- Unit and integration tests: Vitest under Node. Storage, scanner, git reader, domain, CLI, and server API are covered there.
- Smoke matrix in CI: the same scenario (`serve`, `review new`, `comment`, `list --json`, `reply`) runs under Node 22, under Bun, and against the compiled binary of the runner's platform.
- Performance gate: Playwright drives headless Chromium on the synthetic review (21 repositories, 300 files, 30 000 diff lines, 200 comments) and checks first render, CPU per frame while scrolling, zero long tasks, form open, file jump, session switch, and update after an edit against the budget table. The job fails on regression.
- 120 fps is verified by hand on a 120 Hz display at every phase checkpoint and recorded in the acceptance task's `result.md`.
- Every test change is verified with a mutation probe before it is accepted.

## Consequences

- `gates` in `backslop.json` grow with the code: lint, `bun run test`, `bun run lint`, and the performance job.
- A new dependency that breaks Bun or Node shows up in the smoke matrix, not in production.
- The synthetic generator is a first-class artifact: tests and the gate depend on it being deterministic.
