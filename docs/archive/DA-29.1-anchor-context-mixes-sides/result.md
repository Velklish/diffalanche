# DA-29.1 · Result

**Closed 2026-09-05.** Completed. `captureAnchor` in `src/core/domain/anchors.ts` takes `before` and `after` from the lines of the anchored side — `context` and `insert` for `new`, `context` and `delete` for `old` — instead of slicing the hunk's raw line list, so a `new`-side anchor no longer carries text that never existed in the file it is about (what DA-42's re-anchoring will match against). `lineContent`, the hunk header, and the three-line reach are unchanged; CLI and server share the function.

Reviewed by the orchestrator by diff (one filter, the neighbouring reads, the tests): the fix is exactly the finding's proposal.

**Verification.** Reproduced on the small fixture: the comment on `src/Cargos/CargoService497.cs:16` now carries lines 13–15 and 17–18 of the file with no deleted lines. Gates on the worker branch at `2547860` and on `main` after integration: `backslop lint` no errors; `bun run lint` 127 files; `bun run typecheck` three projects; `bun run test` 300 tests on Node and 300 on Bun's runtime (`tests/comments.test.ts`: the fixture test now compares against the new side of the hunk; a hand-made hunk with deletions above and below the anchored line, both sides). Mutation probes after commit: filter removed → 3 tests fail; filter that only drops `delete` lines (the half fix) → the old-side test fails. Perf gate not run: the diff touches nothing under `src/ui`, `perf/`, `vite.config.ts`, `scripts/synth.ts`.

**Documentation in the same pass.** `docs/reference/04-domain.md` (anchor capture), both `skills/*/references/cli.md` (the known-defect note removed, the example JSON regenerated from the fixed CLI), `CHANGELOG.md` (Fixed).
