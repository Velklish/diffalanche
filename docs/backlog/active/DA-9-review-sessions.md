# DA-9 · Review sessions: new, use, list, base change

- **Scope:** 04-domain (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-8
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` sections 4, 5, and 8: a named session with a base mode; exactly one is current through the `current` pointer; the user creates, switches, lists the history, and changes the base of the current session. `base` is `{mode}`, `{mode: "branch", branch?}`, or `{mode: "ref", ref}`.

## Work to do

- `src/core/domain/sessions`: `createSession(name, base, title?)`, `useSession(name)`, `listSessions()` with created and updated timestamps and counters (open, resolved, repositories with changes from `diff.json` if present), `setBase(name, base)`.
- Parsing of the base argument shared by CLI and API: `head`, `branch`, `branch:<name>`, anything else is a `ref`.
- Name validation: lowercase letters, digits, dot, dash, underscore; refusal with a clear message otherwise; refusal when the name exists.
- `updatedAt` bumps on every write to the session's files.

## Out of scope

- `review delete` (Phase 2, DA-40); the CLI surface itself (DA-13).

## Verification

- Vitest: create → the directory and `review.json` exist and `current` names it; create a second → `current` switches; `use` back → `current` switches back; `setBase` writes the new base and bumps `updatedAt`; an invalid name and a duplicate are refused.
