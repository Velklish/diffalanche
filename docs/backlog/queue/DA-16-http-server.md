# DA-16 · HTTP server on Hono: static UI and the review bundle

- **Order:** 160
- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-11, DA-12

## Context

[ADR-002](../../adr/adr-002-stack-and-delivery.md) picks Hono, running through `@hono/node-server` on Node and natively on Bun. `docs/SPEC.md` section 6: nothing loads lazily; everything the review needs arrives when it opens. `docs/design/HANDOFF.md` "Performance & live update": one response, skeleton while waiting. The server listens on `127.0.0.1` only.

## Work to do

- `src/server`: an app factory taking the config and the core services; `GET /api/review` returns the current session's metadata, the change set from `diff.json` (scanning first if absent), comments, counters, and scanner warnings in one response; `GET /api/sessions`; `GET /api/config` (user, port).
- Static serving of `dist/ui` with `index.html` fallback; when running from a binary, files come from the embedded assets (DA-4).
- Startup: bind `127.0.0.1:<port>`, refuse to bind elsewhere, print the URL, exit with a clear message when the port is taken.
- Request logging to stderr at a `--verbose` level only.

## Out of scope

- Writes (DA-17); SSE (DA-18).

## Verification

- Vitest with `app.request`: `/api/review` on the small fixture returns repositories, files, comments, and warnings in one JSON document; `/` returns the UI's `index.html`.
- On the synthetic review the response is produced within the first-render budget's server share recorded in the DA-3 ADR (server time is measured and logged in the test).
- The server refuses `--host 0.0.0.0`; there is no such flag.
