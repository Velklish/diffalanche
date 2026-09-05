# DA-18 · SSE stream of live events

- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-12, DA-16
- **Taken:** 2026-09-05

## Context

[ADR-005](../../adr/adr-005-live-update.md): updates flow server to browser over SSE; the UI fetches only what an event names. Hono ships an SSE helper that works on both runtimes.

## Work to do

- `GET /api/events`: an SSE stream that forwards bus events (DA-12) as named events with JSON data and an incrementing id; a heartbeat comment every 15 s; `Last-Event-ID` replays events from the ring buffer when a client reconnects.
- Activity events are forwarded as `activity` events with author, verb, target, and timestamp.
- Endpoints the UI fetches after an event: `GET /api/repos/:repo/diff`, `GET /api/comments/:id`, `GET /api/warnings`.
- Clean shutdown closes open streams.

## Out of scope

- The browser side (DA-25).

## Verification

- Vitest: a client connected to `/api/events` receives `reply-added` within 300 ms after `diffalanche reply` runs against the same data directory; after a disconnect and reconnect with `Last-Event-ID`, the missed event is replayed; editing a fixture file yields `diff-changed` naming the repository.
