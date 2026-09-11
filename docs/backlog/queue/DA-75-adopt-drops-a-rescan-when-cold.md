# DA-75 · ReviewService.adopt drops a watcher rescan whenever the cached document is null

- **Order:** 150
- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The server keeps one built document for the current session and lets a rescan
patch it in place rather than rebuild it. That is why `serve.ts` subscribes to
the bus and then throws away the one event the rescan sends:

```ts
// src/server/serve.ts:94-98
// A rescan has already patched the document through `onRescan`. A comment
// event changes one small file, and re-reading the whole change set for it
// would charge the next reader of the review for every comment written.
bus.subscribe((event) => {
  if (event.type === "diff-changed") return;
```

The patch it relies on is `adopt`, and `adopt` does nothing when the document is
cold:

```ts
// src/server/review.ts:182-195
adopt: (cache) => {
  if (state === null) return;
  state.document = { ...state.document, repositories: cache.repositories.map(withoutHunks), … };
  state.payload = null;
},
invalidate: () => {
  version += 1;
  state = null;
},
```

`state` is null after every write the API takes: ten `review.invalidate()` calls
in [src/server/app.ts](../../../src/server/app.ts) (lines 217, 228, 234, 240,
279, 285, 304, 314, 320, 331), each of them nulling it. It is also null while a
build is in flight — `current()` assigns `state` only when the promise resolves
(review.ts:136-150) — so the whole duration of a build is a second cold window.

A dropped `adopt` would be harmless on its own, because disk is the source of
truth and the next `build()` re-reads it (`readDiffCache`, review.ts:212). The
defect is the ordering. The watcher announces the rescan **before** it persists
the cache:

```ts
// src/core/watcher/index.ts:238-243
await rescanRepository(config, session, repo, scan, (outcome) => {
  options.onRescan?.(outcome.cache);
  bus.emit({ type: "diff-changed", repo, files });
```

and inside `rescanRepository` that callback runs at index.ts:476, with
`await held.assertHeld()` and `writeDiffCache` after it at index.ts:477-478 —
the full-rescan path is the same shape, `ready?.(outcome)` at index.ts:485
before the lock and the write at index.ts:486-489. The comment at index.ts:234-237
says the ordering is deliberate: "what the person sees must not wait for a file
of megabytes".

So the narrow statement is this: when the document is cold, a `diff-changed`
that the server ignores can trigger a read of a `diff.json` that has not been
written yet, and the result is cached with nothing to invalidate it. The path
runs: the human posts a comment (`review.invalidate()`, state null); the agent
edits the commented file; the watcher rescans, `adopt` returns at review.ts:183,
`diff-changed` is emitted and dropped at serve.ts:98, and `version` is never
bumped; the UI reacts to the event by fetching the repository
([src/ui/live.ts:74-76](../../../src/ui/live.ts)); for the current session that
route resolves through the document —

```ts
// src/server/review.ts:178-181
repository: async (repo, session) =>
  session === undefined
    ? ((await current()).document.repositories.find((one) => one.path === repo) ?? null)
    : freshRepository(config, session, repo),
```

— so it builds, reads the pre-edit `diff.json`, and stores it as `state` because
`version === started` still holds (review.ts:141). The card of the edited file
then shows the pre-edit diff until an unrelated write invalidates, or until a
`warnings` event arrives — and that one is emitted only when
`outcome.warningsChanged` (index.ts:242).

[docs/reference/07-server.md:155-168](../../reference/07-server.md) names this
exact failure for the named-task route — "the card of an edited file never
showed the edit, three times out of three on the synthetic review" — and records
that the current session "showed it every time". This entry is the window in
which that sentence is not true.

What is established from the code is the window: the announce precedes the
write, and nothing invalidates when the state is cold. How often a build lands
inside that window has not been measured, and no losing read is reproduced here;
that part is a hypothesis about timing, not a measurement.

## Work to do

- Decide which invariant the server should hold, and record the reason. The
  candidates: announce only after `writeDiffCache`, which costs the latency the
  comment at index.ts:234-237 exists to avoid and is measured by the update
  budget of `docs/SPEC.md` section 6; keep the ordering and make the cold path
  invalidate, so a build started from that event is discarded (bump `version` in
  `adopt`, or subscribe `diff-changed` to `review.invalidate()` when the service
  holds no state); or hand the fresh cache to the service rather than to the
  document, so a cold build takes the change set from memory instead of racing
  the file.
- Stop `adopt` from being a silent no-op whichever way it goes: it either
  applies the cache or records that it could not, and the caller can tell the
  two apart.
- Cover the in-flight build, not only `state === null`. A build that started
  before the rescan and resolves after it still satisfies `version === started`
  at review.ts:141 and installs the pre-edit document; a fix that only checks
  the null case leaves that half open.
- Say in [docs/reference/07-server.md](../../reference/07-server.md), next to the
  paragraph on the named-task route, what the current session's document is
  guaranteed to be after a rescan, so the next reader does not have to
  reconstruct the ordering from two modules.

## Out of scope

- The named task's own staleness, which is filed: the watcher follows one
  session ([DA-55.1](DA-55.1-watcher-follows-one-session.md)) and the document of
  a named task is built from a cache the watcher never refreshes
  ([DA-55.3](DA-55.3-named-task-document-is-stale.md)). Those are about
  `?review=<name>`; this is about the session the watcher does follow.
- The other branches of the `serve.ts` subscriber. Dropping `sessions-changed`
  (serve.ts:102) is a separate decision with its own comment, and nothing here
  argues against it.
- The comment-only invalidation path (`invalidateComments`, review.ts:196-199),
  which does not touch the change set.

## Verification

- A test that puts the service in the cold state the API really produces — a
  write through a route that calls `invalidate()` — then drives a rescan and
  asserts that the next `GET /api/repos/:repo/diff` for the current session
  carries the post-edit change set rather than the one on disk before it.
- The race is made deterministic rather than waited on: a build that reads
  `diff.json` between the announce and the write must be forced by the test, and
  reverting the fix must turn that test red. A test that only passes because the
  write happened to win first is not a check.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`,
  and `bun run perf` — the perf gate is where an announce moved after the write
  would show, since section 6 measures edit to frame.
