# DA-40 · review delete in CLI and UI

- **Scope:** 04-domain, 06-cli, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-24

## Context

`docs/SPEC.md` section 5 Phase 2 and section 8: the user deletes a review session; sessions are never deleted automatically (decision 5).

## Work to do

- Domain: `deleteSession(name)` removes the directory and its index entries; deleting the current session moves `current` to the most recently updated remaining session or clears it.
- CLI `review delete <name> [--yes]` with a confirmation prompt on a TTY; UI: a delete action in the sessions menu with a confirmation.

## Out of scope

- Trash or undo.

## Verification

- Vitest: deleting the current session updates `current`; the index no longer returns its comments; deleting an unknown name exits 1.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.
