# DA-3 · Spike: diff rendering against the performance budgets

- **Order:** 30
- **Scope:** 08-ui, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-2

## Context

Phase 0 of `docs/SPEC.md` section 10 checks the stack against the budgets before any MVP code. The largest risk is rendering 30 000 diff lines with no lazy loading in 500 ms after the response and scrolling at 120 fps with zero long tasks. `@git-diff-view/react` is the primary library, `react-diff-view` the fallback; the handoff allows virtualisation if it keeps drag selection and thread anchors working (`docs/design/HANDOFF.md`, "Performance & live update"). The spike's code stays as the skeleton of Phase 1 ([ADR-007](../../adr/adr-007-execution-model.md)).

## Work to do

- A minimal server that serves the synthetic review as one JSON response (repositories, files, hunks) and a Vite + React page that renders every file with `@git-diff-view/react` in split view, no virtualisation.
- A Playwright script that loads the page, records first render after the response, long tasks, and CPU time per frame while scrolling through the whole review, and the time to open a composer placeholder and to jump to a file.
- Repeat with `react-diff-view`; repeat with row virtualisation for the winner if the budgets are missed.
- Record every measurement in a new ADR "Diff rendering verdict": the library, whether virtualisation is needed, and the numbers per budget line.

## Out of scope

- Real comments, threads, the composer, the sidebar; styling beyond what the measurement needs.

## Verification

- The ADR contains the budget table of `docs/SPEC.md` section 6 filled with measured numbers for each variant tried.
- The chosen variant meets first render ≤ 500 ms, zero long tasks while scrolling, file jump ≤ 50 ms on the synthetic review on the development machine.
- If no variant meets the budgets, the ADR names the stack change and this task is reopened with the new stack.
