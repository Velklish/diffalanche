# DA-28 · UI end-to-end tests on the fixture root

- **Scope:** 08-ui, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-15, DA-25, DA-26
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 10, Phase 1 acceptance criteria, checked on a fixture root with `repos/<group>/<repo>` layout. Individual UI tasks verify their own pieces; this task makes the acceptance list one Playwright suite that runs in CI against the built binary of the runner's platform.

## Work to do

- `e2e/` suite: every acceptance criterion of section 10 that involves the UI — repositories with changes listed, sibling worktree listed, nested submodule not listed, untracked file in the diff, `branch` mode on a feature branch, comment from the UI in `list --json` without restart, reply from `reply` in the UI without refresh, `resolve` from the UI removing from `list --status open`, agent reply in the activity feed, `review use` switching both sides.
- The suite starts the binary on a free port with the fixture, runs against it, and stops it; a CI job on ubuntu and macos.
- A short `docs/reference/08-ui.md` section on how to run and debug the suite.

## Out of scope

- Performance measurements (DA-5 owns the harness).

## Verification

- The `e2e` job is green on `main` for both platforms.
- Each criterion maps to a named test, listed in the job summary.
