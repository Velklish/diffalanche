# DA-123 · Writer pass over the backslop v0.20.0 run, batch close

- **Scope:** all subsystems (see [reference](../../reference/README.md)); documentation the run touched
- **Created:** 2026-10-03
- **Dependencies:** DA-122
- **Previous order:** 775
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

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

## Execution plan

The historical writer input is `8236520021d0ca765d3e0fa8fe652556d7df50d5^..c79226d4f3a27f5e603fe6042563f7eb72cacae9`, covering the DA-119 through DA-122 run. Keep one row per document and behavior-changing commit; this pass is distinct from the final currency pass for the current implementation run. Findings outside already authorized corrections are registered, not silently fixed.
