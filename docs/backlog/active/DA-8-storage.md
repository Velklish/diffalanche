# DA-8 · Storage: session directories, lock, atomic writes

- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-1
- **Taken:** 2026-09-05

## Context

[ADR-003](../../adr/adr-003-on-disk-format.md) and `docs/SPEC.md` section 7: a session is `reviews/<name>/` with `review.json`, `comments.json`, `diff.json`; `current` and `config.json` next to `reviews/`. Writes from the server and from several CLI processes must lose nothing.

## Work to do

- `src/core/storage`: locate or create the data directory; read and write `review.json`, `comments.json`, `diff.json`, `current`; JSON with `version: 1` and two-space indentation so files stay readable and diffable.
- `withLock(sessionDir, fn)`: `mkdir` of `.lock`, bounded retry with backoff, stale-lock takeover after a timeout recorded in the lock, release in `finally`.
- Atomic write: temporary file in the same directory, `fsync`, `rename` over the target.
- Read-modify-write helper for comments used by every writer; validation of the schema on read with a clear error naming the file and field.
- Session listing from directory names; ignore directories without `review.json` with a warning.

## Out of scope

- Domain rules about comments (DA-10); watching files (DA-12); migrations between schema versions (a task when version 2 appears).

## Verification

- Vitest: 20 concurrent writers (worker threads or child processes) each append one reply to the same comment; the result has all 20 replies in order of arrival.
- A crash simulated between temporary write and rename leaves the previous file intact.
- A hand-edited `comments.json` with an extra reply is read back unchanged.
- A stale lock older than the timeout is taken over and the write succeeds.
