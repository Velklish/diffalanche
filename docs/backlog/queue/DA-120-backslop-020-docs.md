# DA-120 · Documentation states its facts without task numbers: README, reference, design, spec, glossary

- **Order:** 600
- **Scope:** all subsystems (see [reference](../../reference/README.md)); `README.md`, `docs/design/`, `docs/SPEC.md`, `docs/GLOSSARY.md`
- **Created:** 2026-10-03
- **Dependencies:** DA-119

## Context

Gate 15 of backslop v0.20.0 reads the root `README*.md`, every `.md` under `docs/`
except `backlog/` and `archive/`, and the `[Unreleased]` section of `CHANGELOG.md`.
A task number or a tracker link there is an error. The probe of 2026-10-03 on
`b5092d2` counted, for this task's files: `docs/reference/11-perf.md` 123,
`08-ui.md` 67, `09-ml.md` 16, `07-server.md` 12, `05-watcher.md` 11,
`03-storage.md` 10, `06-cli.md` 7, `02-git.md` 6, `04-domain.md` 4, `10-skills.md` 2,
`reference/README.md` 2, `README.md` 4, `docs/design/HANDOFF.md` 4, `docs/SPEC.md` 3,
`docs/GLOSSARY.md` 1.

## Work to do

- Replace each task number with what it stood for: the contract, the reason, or the
  measurement with its version and date. `show N` and `docs/archive/LOG.md` say what
  stood behind a number.
- Drop a number outright only where the sentence already says the substance.
- Remove a tracker link and keep, as text, the fact it was there for.
- Never remove a statement.

## Out of scope

- `docs/adr/` and `CHANGELOG.md` (DA-121).
- `docs/ROADMAP.md` is in scope for gate 15 only if `lint` reports it; it stays as
  project content.

## Verification

- `lint` reports no error in this task's files, and the total fell by exactly their
  count.
- The diff removes no statement: every removed line's fact is present in the new text.
