# DA-30 · README and subsystem reference

- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-14, DA-16
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 10 lists README among Phase 1 deliverables. The subsystem reference `docs/reference/README.md` currently holds only a table of planned sections; each task documents what it builds, and this task makes the set consistent for a first reader.

## Work to do

- `README.md`: what diffalanche is, install through `npx diffalanche` and binaries, first run, `config.json`, the CLI reference generated from `--help`, the agent protocol and skills, development and testing, license.
- `docs/reference/01-scanner.md` to `08-ui.md`, `10-skills.md`, `11-perf.md`: written from the code, one page each, entry points and behaviour; `09-ml.md` is a stub naming Phase 2.
- `CHANGELOG.md` with an `Unreleased` section listing Phase 1.
- Glossary check: every term used in README and reference is in `docs/GLOSSARY.md` or is added there.

## Out of scope

- Publishing or versioning (DA-31).

## Verification

- `npx github:Velklish/backslop#v0.3.1 lint` is green (links resolve).
- Every command of `docs/SPEC.md` section 8 that exists in Phase 1 has a README entry with the same flags as `--help`, checked by a script that diffs the two.
