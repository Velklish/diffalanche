# DA-119 · backslop v0.20.0: pin, hooks for claude, and the layout errors outside documentation

- **Order:** 400
- **Scope:** all subsystems (see [reference](../../reference/README.md)); `backslop.json`, `AGENTS.md`, `.claude/settings.json`, `docs/backlog/`, `docs/archive/`
- **Created:** 2026-10-03
- **Dependencies:** none

## Context

The tracker is pinned to backslop v0.9.0. v0.20.0 adds the closed task journal
`docs/archive/LOG.md` with `fold` and `show`, agent hooks (`init --hooks`), the
`backslop-writer` skill, and gate 15: documentation outside the tracker carries no
task numbers and no tracker links.

A probe on a disposable clone of `b5092d2` (2026-10-03): `upgrade --to 0.20.0` exits
0, then `lint` exits 1 with 513 errors. 507 of them are gate 15 and belong to the two
tasks that follow this one. The other six are this task's:

- three `result.md` files whose first paragraph names no outcome:
  `docs/archive/DA-111-…`, `docs/archive/DA-112-…`, `docs/archive/DA-16.1-…`;
  a fold would record them wrongly;
- the minor entry DA-56.1 has no "Evidence" section;
- the anchor `in-the-server` in `docs/archive/DA-34.1-…/result.md` resolves to nothing;
- a link to a directory in `docs/backlog/deferred/DA-90.1-…`.

The probe also showed: `upgrade` keeps `docs/ROADMAP.md` with a warning; `migrate`
rewrites `docs/backlog/README.md` and `docs/archive/README.md` from the template and
loses the product name in the first line of the backlog README; `init` notes that
`probe` is not declared.

## Work to do

- `upgrade --to 0.20.0`: the pin moves in every live place (`backslop.json` `cli` and
  gate, the `AGENTS.md` block, adapter outputs, prose).
- `init --hooks claude`. `.claude/settings.json` already has a `SessionStart` hook of
  the project's own; it stays, next to the hook records `init` adds.
- `docs/ROADMAP.md` stays as project content.
- Restore what `migrate` dropped from the first line of `docs/backlog/README.md`.
- Name the outcome in the first paragraph of the three `result.md` files, from what
  each file already says.
- Give DA-56.1 an "Evidence" section with the evidence its text already carries.
- Fix the anchor and the directory link.

## Out of scope

- Gate 15 in documentation, ADRs and CHANGELOG (DA-120, DA-121).
- Hooks for codex and cursor: they follow a release of the session bus that
  tolerates a project's own hook layer.
- Declaring `probe`: the project has no mutation probe.
- Folding the archive (DA-122).

## Verification

- `lint` reports only gate 15 errors, and their count equals the probe's 507 or
  differs by a number the result explains file by file.
- Every other gate of `backslop.json` exits 0.
- `git diff` of `.claude/settings.json` keeps the existing `SessionStart` record.
