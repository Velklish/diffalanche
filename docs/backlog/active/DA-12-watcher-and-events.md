# DA-12 · Watcher and activity events

- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-7, DA-9, DA-10
- **Taken:** 2026-09-05

## Context

[ADR-005](../../adr/adr-005-live-update.md): the server watches the reviewed repositories and the data directory, rescans one repository per change, rewrites its part of `diff.json`, and emits incremental events; activity events are derived from diff changes and CLI writes. Budget: 300 ms from an edit in one repository to the update (`docs/SPEC.md` section 6).

## Work to do

- `src/core/watcher`: recursive `fs.watch` where the platform supports it, polling fallback otherwise; ignores `.git` internals except `HEAD` and `index`, `node_modules`, and `exclude` globs; debounce per repository (about 100 ms).
- In-process event bus with typed events: `diff-changed {repo, files}`, `comment-added {id}`, `reply-added {id, commentId}`, `comment-status {id}`, `session-changed {name}`, `warnings {list}`.
- Incremental rescan: on a repository change, recompute that repository's diff and replace its entry in `diff.json` under the storage lock; on a data-directory change, reload the affected session file and emit the difference as comment events with the author from the file.
- Activity event ring buffer (last 200): "diff changed in <repo>", "<author> is editing <repo>" when a CLI write with that author touched that repository within the last two minutes and its diff keeps changing, "<author> replied in <file>", "<author> commented on <file>".

## Out of scope

- Transport to the browser (DA-18); re-anchoring (Phase 3).

## Verification

- Vitest with a real fixture: editing a file emits `diff-changed` for that repository only and `diff.json` holds the new hunk within 300 ms (measured in the test, asserted at 300 ms with a note that CI machines may need a larger tolerance recorded in the reference).
- Appending a reply to `comments.json` through the storage API from another process emits `reply-added` with the reply's author.
- No event is emitted for changes inside `.git/objects`.
