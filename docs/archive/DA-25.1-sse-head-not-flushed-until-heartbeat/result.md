# DA-25.1 · Result

**Closed 2026-09-05.** Completed. `src/server/events.ts` writes a `: connected` comment as soon as the client is subscribed and before the replay, so the response head is flushed at once (measured before: 15 807 ms to `onopen`, the first heartbeat) rather than after however much was missed. `src/ui/live.ts` reads the real `onopen` again; the `GET /api/activity`-as-proof workaround is gone.

**Verification.** `tests/events.test.ts` measures the head over a socket, not through `app.request` — it is the socket that buffers — and requires it within a second carrying `connected`; the heartbeat test expects that comment first. Mutation probe after commit: `stream.write(HELLO)` removed → the head test and the heartbeat test fail.

**Documentation in the same pass.** `docs/reference/07-server.md` (the connect frame), `docs/reference/08-ui.md`, `CHANGELOG.md`.
