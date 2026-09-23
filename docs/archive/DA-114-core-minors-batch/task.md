# DA-114 · Core minors: parseDiff notes out-parameter (DA-76.3), silent walk fallback (DA-85.1), four git processes in docs (DA-61.1), scope read outside the lock (DA-67.1), raw ENOTDIR (DA-99.1)

- **Order:** 265
- **Scope:** 02-git, 03-storage, 04-domain, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Dependencies:** none

## Context

The run of 2026-09-23 touches the change set, the watcher and the cache anyway (DA-80, DA-55.5), so the minor entries filed against those scopes are cut into one batch here rather than left waiting. Each entry keeps its own evidence in `minor/`; this card only names them.

## Work to do

- [DA-76.3](minor/DA-76.3-parse-diff-notes-out-parameter.md) — `notes` is an out-parameter of `parseDiff`, so a caller that forgets it drops the warning without a sound.
- [DA-85.1](minor/DA-85.1-runtime-without-recursive-watch-says-nothing.md) — a runtime that never had a recursive watch starts on the walk and says nothing.
- [DA-61.1](minor/DA-61.1-four-git-processes-stale-in-neighbour-sections.md) — "four git processes" is now wrong in eight places outside the git track.
- [DA-67.1](minor/DA-67.1-scope-read-outside-the-lock-in-reply-resolve-reopen.md) — `reply`, `resolve` and `reopen` read the scope outside the lock.
- [DA-99.1](minor/DA-99.1-storage-exists-rethrows-enotdir.md) — a file where a session directory should be reaches the person as a raw `ENOTDIR` from `exists()`.

Each entry is fixed, or closed with a stated reason why not; the outcome of each is one line in this batch's `result.md`.

## Out of scope

- [DA-76.4](../../backlog/minor/DA-76.4-parse-diff-may-cost-ten-ms-on-the-rescan-path.md) — a performance hypothesis; it needs a quiet machine and goes with the perf pass.
- 08-ui entries: [DA-113](../DA-113-ui-minors-56-2-76-2/task.md).

## Verification

- Every behaviour fix has a test that turns red when the fix is reverted, or the result says why a test cannot hold it; DA-61.1 is prose and is checked by `grep` over `docs/`.
- Gates: `npx github:Velklish/backslop#v0.9.0 gates` green by count.
