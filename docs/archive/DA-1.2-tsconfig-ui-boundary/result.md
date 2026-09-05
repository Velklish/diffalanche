# DA-1.2 · Result

**Closed 2026-09-05.** Merged into DA-19: the tsconfig split (root config without `DOM` for core, CLI, server, scripts, tests; a separate config with `DOM` and without Node types for `src/ui`, wired as a project reference) is cheapest to land in the pass that creates the UI shell. The full content of this entry was copied into the DA-19 task file.

**Verification.** Not applicable to the merge; DA-19 inherits the probe (`document.title` in `src/server/index.ts` fails `bun run typecheck`, the same reference in `src/ui` passes).

**Documentation in the same pass.** Not required.
