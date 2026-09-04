# ADR-005: File watcher, SSE stream, in-memory activity events

**Status:** Accepted
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

The review must update by itself when code or comments change, without a reload and without losing the reading position, within 300 ms after an edit in one repository (spec sections 5 and 6). The design adds an activity feed: which repository's diff changed, which agent replied where. The spec had no notion of an event, and agents have no heartbeat the tool could listen to. Evidence: `docs/SPEC.md` section 5, `docs/design/HANDOFF.md` section 4.

## Options

- **Transport → SSE / WebSocket.** Updates flow one way, server to browser; POST covers the other direction. `EventSource` reconnects on its own and needs no library. WebSocket is bidirectional, has different implementations on Node and Bun, and buys nothing here.
- **Event source → derived from the watcher and CLI writes / explicit agent heartbeat.** A heartbeat would need every agent skill to call something extra and would still miss agents that do not. Derived events cost nothing to the agent.
- **Event storage → memory only / on disk.** Events are transient by nature; on disk they would be one more file to lock.

## Decision

- The server watches the reviewed repositories (working trees) and the data directory. Changes are debounced per repository; a change rescans only that repository and rewrites its part of `diff.json`.
- The server pushes incremental events over SSE: `diff-changed` with the repository, `comment-added` and `reply-added` with the ids, `session-changed`, `warnings`. The UI fetches only what the event names.
- Activity events are derived: `diff-changed` becomes "diff changed in <repo>" and, while changes keep coming, "<author> is editing <repo>" when a recent CLI write names an author for that repository; a reply or comment with `role: agent` becomes "<author> replied in <file>". Events live in the server's memory, capped at a fixed number, and are gone when the server stops.

## Consequences

- The 300 ms budget is measured from the file change to the SSE event plus the UI patch; the watcher and the incremental rescan are on that path.
- A live change in the open file patches only the affected hunks and threads; the composer and reading position stay.
- Comments that lose their line after a change are marked `orphaned` in Phase 3; the MVP keeps them where they are and shows a warning.
