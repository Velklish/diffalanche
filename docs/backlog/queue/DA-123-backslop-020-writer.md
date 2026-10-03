# DA-123 · Writer pass over the backslop v0.20.0 run, batch close

- **Order:** 775
- **Scope:** all subsystems (see [reference](../../reference/README.md)); documentation the run touched
- **Created:** 2026-10-03
- **Dependencies:** DA-122

## Context

backslop v0.20.0 ships the `backslop-writer` skill. Its batch close mode reads the
documentation a run touched and files what it finds. This run (DA-119 to DA-122)
rewrote large parts of the documentation by hand.

## Work to do

- Run `backslop-writer` in batch close mode over the run's range of commits.
- Keep the ledger in this task's `result.md`.
- File every finding as a card with its cost label.

## Out of scope

- Fixing the findings in this task.

## Verification

- The ledger lists every document of the range with its verdict.
- Every finding has a card; `lint` and every other gate exit 0.
