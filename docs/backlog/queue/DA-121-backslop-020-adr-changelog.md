# DA-121 · ADRs and the unreleased CHANGELOG state their facts without task numbers

- **Order:** 700
- **Scope:** all subsystems (see [reference](../../reference/README.md)); `docs/adr/`, `CHANGELOG.md`
- **Created:** 2026-10-03
- **Dependencies:** DA-119

## Context

Gate 15 of backslop v0.20.0 covers ADRs and the `[Unreleased]` section of
`CHANGELOG.md`. The probe of 2026-10-03 on `b5092d2` counted `CHANGELOG.md` 164,
`adr-013` 20, `adr-008` 15, `adr-014` 9, `adr-016` 8, `adr-012` 4, `adr-007`,
`adr-009`, `adr-010` 3 each, `adr-004`, `adr-011`, `adr-015` 2 each. There is no
release, so the entries stay under `[Unreleased]`.

## Work to do

- Replace each task number with what it stood for: the contract, the reason, or the
  measurement with its version and date. `show N` and `docs/archive/LOG.md` say what
  stood behind a number.
- Drop a number outright only where the sentence already says the substance.
- Remove a tracker link and keep, as text, the fact it was there for.
- Never remove a statement, and never change what an ADR decided.

## Out of scope

- README, reference, design, spec and glossary (DA-120).

## Verification

- `lint` reports no error in this task's files, and the total fell by exactly their
  count.
- The diff removes no statement: every removed line's fact is present in the new text.
