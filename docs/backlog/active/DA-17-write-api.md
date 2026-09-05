# DA-17 · Write API: comments, sessions, base, export

- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-10, DA-16
- **Taken:** 2026-09-05

## Context

The UI writes through the server; the HTTP API is not a contract for agents ([ADR-004](../../adr/adr-004-agent-contract.md)) but must use the same domain and storage code as the CLI so both interleave safely ([ADR-003](../../adr/adr-003-on-disk-format.md)). The UI writes `author` from `config.user` and `role: human`.

## Work to do

- Routes: `POST /api/comments`, `POST /api/comments/:id/replies`, `POST /api/comments/:id/resolve`, `POST /api/comments/:id/reopen`, `POST /api/sessions`, `POST /api/sessions/:name/use`, `PUT /api/sessions/:name/base`, `GET /api/export?status=&format=`.
- Every write calls the domain (DA-10, DA-9) with `author: config.user`, `role: human`; responses return the updated comment or session.
- Validation errors return 400 with the domain message; unknown ids 404.

## Out of scope

- Authentication (non-goal); deleting sessions (DA-40).

## Verification

- Vitest with `app.request` on the fixture: a comment created over the API appears in `diffalanche list --json` run against the same data directory; a reply written by the CLI appears in `GET /api/review`; `resolve` over the API sets `resolvedBy` to `config.user`.
