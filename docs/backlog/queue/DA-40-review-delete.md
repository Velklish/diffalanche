# DA-40 · review delete in CLI and UI

- **Order:** 400
- **Scope:** 04-domain, 06-cli, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-24

## Context

`docs/SPEC.md` section 5 Phase 2 and section 8: the user deletes a review session; sessions are never deleted automatically (decision 5).

## Work to do

- Domain: `deleteSession(name)` removes the directory and its index entries; deleting the current session moves `current` to the most recently updated remaining session or clears it.
- CLI `review delete <name> [--yes]` with a confirmation prompt on a TTY; UI: a delete action in the sessions menu with a confirmation.

## What Phase 1 changed

Phase 1 built the sessions menu this task adds to (DA-24: `src/ui/components/Header.tsx`, a labelled region rather than an ARIA menu because it holds a form), the session routes (`POST /api/sessions`, `POST /api/sessions/:name/use`) and the CLI's `review new / use / list`. A delete is a session write the page itself causes: the live client skips the `session-changed` frame of its own writes through a marker map in the store (`markSelfSession`, DA-25's review fixes), and a delete must mark itself the same way. `current` semantics are in [03-storage.md](../../reference/03-storage.md); the README's CLI table is guarded by `tests/readme-cli.test.ts`. If the owner takes the caching half of DA-24.1, a deleted session must drop its cached document.

## Out of scope

- Trash or undo.

## Verification

- Vitest: deleting the current session updates `current`; the index no longer returns its comments; deleting an unknown name exits 1.

