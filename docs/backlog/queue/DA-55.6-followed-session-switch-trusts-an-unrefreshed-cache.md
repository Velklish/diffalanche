# DA-55.6 · A session that becomes the followed one while the server runs is served from a diff.json nothing refreshed

- **Order:** 760
- **Scope:** 07-server, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Dependencies:** none
- **Parent:** DA-55.5
- **Cost:** major

## Context

Found while closing DA-55.5, and it is the boundary of that fix. DA-55.5 made
the first document of a server's lifetime come from a read of the working tree:
before the socket opens, the watcher's `refresh` reads the current session's
scope, because nothing refreshed that session's `diff.json` while no server ran.

The same is true of any session **at the moment the watcher starts following
it**. The server trusts `diff.json` for the followed session, whichever one that
is when the document is built:

<!-- quote:../../../src/server/review.ts -->
```ts
  if (followed) {
    const adopted = entry.adopted;
    if (adopted !== null && answers(adopted, review)) return adopted;
    const cached = await readDiffCache(config.dataDir, session);
    if (cached !== null && answers(cached, review)) return cached;
  }
  return rebuild(config, session, review);
```
<!-- /quote -->

`review use B` moves `current`, and the watcher follows B from then on
(`reloadCurrent` in `src/core/watcher/index.ts` reads B's comments, metadata and
scope, and rescans nothing). B's `diff.json` was last written when B was last
followed, or when B was last read as a named task — and between then and now a
rescan of the followed session A wrote A's file only. A repository of B's scope
that moved in between is shown as it was until a file in it is touched again.

Reproduced at the service level on the small synthetic review, with a scratch
test that is not committed: `named` read as a named task (so its `diff.json` is
written), a line appended to a modified file of its first repository,
`repositoryChanged` for that repository, then `watched()` switched to `named`.
The next `document("named")` did not contain the appended line, while a fresh
`createReviewService(config).document("named")` on the same tree did — both
assertions held, `npx vitest run tests/zz-scratch-55-6.test.ts`, exit 0.

Not established: how the watcher and the server behave with a real
`review use` between two builds, as opposed to the service with its `watched`
answer switched by hand. The path is read from the code, not run end to end.

## Work to do

- Decide whether a switch of the followed session refreshes the new one. The
  natural answer is the one DA-55.5 took at startup — `refresh` queued when
  `reloadCurrent` moves to a new session — and its cost is the new session's
  scope, paid in the background on every `review use`, which the session-switch
  budget of `docs/SPEC.md` section 6 does not cover today (the perf harness
  switches by `?review=`, not by moving `current`).
- Whichever is chosen, say it in [07-server.md](../../reference/07-server.md)
  under **The review document**, where DA-55.5 left this boundary named.

## Out of scope

- The startup window, which DA-55.5 closed.
- Named tasks, which DA-55.3 closed: they are read from the working tree
  whenever their document is built.

## Verification

- A session made current while the server runs, after a repository of its scope
  changed while it was not followed, answers `GET /api/review` with that change.
  Reverting the fix turns the test red.
