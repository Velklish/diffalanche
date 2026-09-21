# DA-77 · The scope editor of a window on ?review=X picks from candidates computed against the current session

- **Order:** 140
- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`?review=<name>` is the task a window is on, and [08-ui.md](../../reference/08-ui.md) states the
rule: the name is read once and from then on *every request of the page carries it*, reads and
writes alike, so that a window cannot read one task and write into another. The scope editor breaks
that rule on the read side — it picks from a list computed against the **current** session's base
and writes the picked list into the window's own task. The list has no session to be about, all the
way down. The route drops it:

[src/server/app.ts:133](../../../src/server/app.ts)

```ts
app.get("/api/sessions/candidates", async (c) => c.json(await review.candidates()));
```

`named(c)` (app.ts:73-76) is what reads `?review=`, and this is one of the routes that never calls
it. It could not pass the name anyway — `candidates: () => Promise<CandidateSet>` on the service
interface (review.ts:108) takes no parameter — and the implementation resolves the base from
whatever `current` names:

[src/server/review.ts:318-364](../../../src/server/review.ts)

```ts
async function candidatesOf(config: Config): Promise<CandidateSet> {
  const found = await scan(config.root, { … });
  const base = await sessionBase(config);
…
/** Without a session there is no base to read against; the default one is HEAD. */
async function sessionBase(config: Config): Promise<Base> {
  try {
    const session = await resolveSessionName(config.dataDir);
    return (await readReview(config.dataDir, session)).base;
  } catch {
    return { mode: "head" };
  }
}
```

`resolveSessionName` with no name is `current`, so the base is the current session's or, failing
that, `head`. The client matches: `loadCandidates` is a bare
`fetch("/api/sessions/candidates")` at [src/ui/store.ts:1662](../../../src/ui/store.ts) with no
`onTask()`, unlike `loadReview`, the thread reads, the live repository fetch and the export — while
the write side of the same editor does carry the window's task, posting to
`/api/sessions/${session.name}/scope` ([store.ts:808](../../../src/ui/store.ts)).

Reproduced on a scratch root under Bun with two sessions, `cur` on `head` (current) and `x` on the
first commit: `GET /api/review?review=x` answers with repository `r1` and `b.txt` changed, while
`GET /api/sessions/candidates` — with or without `?review=x` — answers `repositories: []`. The
scope editor of a window on `x` offers nothing to tick. The mirror case is the same bug pointing the
other way: a file dirty only in the working tree is offered and written into `x`'s scope, where
`x`'s base does not show it. Nothing downstream catches either — `assertScope`
([src/core/domain/scope.ts:93-125](../../../src/core/domain/scope.ts)) checks containment and
states as a decision that whether the file has changes is not asked.

It needs no link to reach: switching a task in the sessions menu writes `?review=<name>` and
re-reads the review ([08-ui.md](../../reference/08-ui.md)). And the behaviour is asserted as a
design statement — [07-server.md](../../reference/07-server.md) lists this route among "the three
answers about the whole root … about no session at all" — so it is a documented decision that is
wrong, not an oversight in prose. DA-55.1 and DA-55.3 are about the watcher and the cached
document; neither is about the base the candidates are read against.

## Work to do

- Decide which of two readings is right, and record it where the assertion currently lives: either
  the candidate set is per session and takes the name like every other read of the page, or it is
  genuinely root-wide and is then computed against something no session owns (`head` everywhere,
  with the picker saying so). The first keeps the picker honest about what the task will show; the
  second makes the endpoint's name true. The bug is that the code claims the second and does the
  first.
- Carry the name end to end if the first is chosen: `candidates(named?: string)` on the
  `ReviewService` interface, `named(c)` on the route, `sessionBase(config, named)` resolving through
  the same `resolveSessionName(config.dataDir, named)` that `build()` already uses, and `onTask()`
  around the fetch in `loadCandidates`.
- Update [07-server.md](../../reference/07-server.md) — the sentence that groups this route with
  `/api/scan` and `/api/sessions` as sessionless — and the request list in
  [08-ui.md](../../reference/08-ui.md), which claims every request already carries the task. Leave
  `assertScope` alone: a scope entry with nothing to show is kept on purpose, and the fix belongs
  where the list is produced rather than where it is validated.

## Out of scope

- The watcher following one session (DA-55.1) and the named task's stale cached document (DA-55.3):
  the same window, different mechanism. Session identity in live frames and the rest of the store's
  loads is DA-68, and `serve --review` is DA-81; this entry is one route and the one fetch of it.
- The base picker's branch list (`GET /api/repos/branches`), which is root-wide by nature: it
  enumerates refs, not changes, and has no base to be computed against.

## Verification

- A server test creates two sessions with different bases in one root, asks
  `GET /api/sessions/candidates?review=<the non-current one>`, and gets the change set of that
  session's base — a repository that only the non-current base shows is present, and a file dirty
  only in the working tree is absent when that base is a commit. Dropping `named(c)` from the route
  again turns it red.
- `tests/scope.test.ts:614` ("offers the whole root as candidates, whatever the task is about")
  is rewritten rather than kept: its sentence is the claim this task retires, and it must end up
  asserting the decided behaviour.
- A UI test asserts `loadCandidates` requests through `onTask()`, so the window's task reaches the
  wire.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
