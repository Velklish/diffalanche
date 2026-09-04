# ADR-003: A directory per review session, whole-file writes under a lock

**Status:** Accepted
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

The spec requires plain JSON on disk, readable and editable by hand, with no data loss when the UI and several agent CLI processes write at the same time (section 3, decision 5). The first draft kept one file per session. Two things pushed against it: the diff has to be readable by an agent without a running server, and a single file mixes data with different writers and different lifetimes. Evidence: `docs/SPEC.md` section 7.

## Options

- **Layout → one file per session / a directory per session.** One file is simplest but puts the diff cache, which the scanner rewrites on every change, into the same file as comments written by people and agents. A directory separates them.
- **Concurrency → lock plus atomic rename / CLI writes through the server when it runs / append-only event log.** The lock keeps one code path for server and CLI and keeps the CLI usable without a server. Routing through the server adds a second write path and still needs the lock for the offline case. An event log removes conflicts but the file is no longer editable by hand, which breaks the spec.

## Decision

- A review session is the directory `reviews/<name>/` with `review.json` (metadata and base), `comments.json` (threads), and `diff.json` (cache of the last scan). `current` and `config.json` stay next to `reviews/`.
- `diff.json` is written only by the scanner (server or `diff` command) and is overwritten whole on every scan. Git remains the source of truth.
- Every write to `review.json` or `comments.json` is read-modify-write under a lock: a `.lock` directory created with `mkdir` inside the session directory, with a bounded wait and a stale-lock timeout, followed by writing a temporary file and renaming it over the target. Server and CLI share this code in `src/core/storage`.
- The server watches the session directory and reloads a file that changed underneath it.

## Consequences

- Agents can read the change set from `diff.json` with no server; the UI opens from the cache while the scanner refreshes it.
- A test with N concurrent writers is part of the storage task and a gate for any later change to the storage code.
- Hand edits to `diff.json` are lost on the next scan; the spec says so.
- Backup and version control of a session is a copy of one directory.
