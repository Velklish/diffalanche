# DA-78 · The session lock's release checks ownership and deletes in two steps, so an expired holder can delete another writer's lock

- **Order:** 90
- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`release()` is the one step of the session lock that was not made atomic, and its own docblock names
the hazard it is open to:

[src/core/storage/lock.ts:195-204](../../../src/core/storage/lock.ts)

```ts
/**
 * Releases the lock only while it is still ours: a lock taken over as stale
 * belongs to the writer that took it, and removing it would hand a third
 * writer the same session at the same time.
 */
async function release(lockDir: string, token: string): Promise<void> {
  const info = await readInfo(lockDir);
  if (info?.token !== token) return;
  await rm(lockDir, { recursive: true, force: true });
}
```

The read and the delete are two awaits with nothing atomic between them, and `rm` removes whatever
directory is at that path when it runs — not the one whose `info.json` was read. The sibling path
was deliberately written the other way round for exactly this reason: `takeOverIfStale`
(lock.ts:121-164) renames the stale lock aside *first* and only then reads the token out of what it
moved, because "two writers that find the same stale lock would both remove it … A rename is
atomic, so exactly one of the two moves the stale lock". `release` never got that treatment, and
`withLock` always reaches it — `finally { await release(lockDir, token); }` (lock.ts:74-78) runs
even when the body failed because the lease had already lapsed.

The harmful interleaving is one window wide. Writer A holds the lock through a body longer than
`DEFAULT_STALE_MS` (lock.ts:18, 30 s), enters `release`, reads `info.json`, sees its own token, and
is descheduled. Writer B, in another process, finds the lock stale, renames it aside, deletes the
renamed directory, sleeps `FIRST_RETRY_MS` (lock.ts:19, 5 ms), retries `mkdir`, succeeds, writes its
own `info.json`, and enters its body. A resumes and `rm`s the lock directory — B's live lock. C's
`mkdir` then succeeds while B is still writing, and one session has two holders. The window A must
lose is bounded below by B's 5 ms sleep, so a `git diff` burst or a GC pause is enough; the two
writers are separate OS processes, which is the case this lock exists for at all. The benign
interleavings are already safe: if the directory has been renamed aside before A's read, `readInfo`
returns `null` and A returns early, and if it has been recreated before A's read the token does not
match.

`assertHeld` does not close it. Two of the three writing bodies check the lock once and then issue
more than one write: `updateSession` calls `held.assertHeld()` and follows it with `writeReview` and
`writeComments` ([src/core/storage/index.ts:298-300](../../../src/core/storage/index.ts)), and the
watcher's rescan does the same before `writeDiffCache`
([src/core/watcher/index.ts:477-478](../../../src/core/watcher/index.ts)). A takeover landing
between the check and either write is unobserved, and the best case of B's side is the misleading
refusal "the lock was taken over while this write was in progress" (lock.ts:186-192) when nothing
about B's body outran anything.

Nothing in the race suite reaches this path. All three cases in
[tests/storage-lock-race.test.ts](../../../tests/storage-lock-race.test.ts) stall the takeover:
`beforeTakeoverMove` fires on a rename into `.stale-`, `beforeClaimWrite` on the rename of
`info.json`, and `slowFirstRm` is gated on `rmCalls === 1`, which is `takeOverIfStale`'s
`rm(aside)`. No hook stalls a writer between `release`'s `readInfo` and its `rm`.

[03-storage.md:136-140](../../reference/03-storage.md) states the release rule as if it were
settled — "Release is conditional on the token in `info.json` still being ours. Without that check a
writer whose lock was taken over as stale would delete the lock of the writer that took it" — which
is the right requirement and an inaccurate description of what the code achieves.

## Work to do

- Make release destroy only the directory it verified. The same primitive the takeover already uses
  fits: rename `lockDir` aside under a unique name, read the moved `info.json`, and delete the
  renamed directory when the token is ours — renaming it back, as `takeOverIfStale` does, when it is
  not. Nothing else in the module needs to change for this shape.
- Decide what release does when the rename fails with `ENOENT` (the lock is already gone, which is
  the ordinary case after a takeover) versus when the moved directory has no `info.json` at all;
  the takeover path already has an answer for the second and release should not invent a different
  one.
- Keep the cost of the common case in view: an uncontended release currently costs one read and one
  `rm`, and the rename adds a syscall on a path that every write ends with. If that is judged too
  much, the alternative to weigh is making release unconditional but only reachable while the lease
  has not lapsed — say which is chosen and why, rather than leaving both readings open.
- Correct [03-storage.md](../../reference/03-storage.md) in the same pass: the paragraph on release
  and the "end-to-end guarantee is the rename together with `assertHeld`" paragraph above it both
  describe a release that this task is what makes true.

## Out of scope

- The two writes that run outside the lock entirely, filed as DA-67.
- A lock left by a killed writer never being taken over because the wait is shorter than the lease,
  filed as DA-89 — the same module, the opposite end of the lease.
- `writeFileAtomic` not syncing its directory, filed as DA-90.
- Making `updateSession` and the watcher's rescan single-write operations. Narrowing the window
  between `assertHeld` and the writes is worth its own decision and does not fix this.

## Verification

- A race test in `tests/storage-lock-race.test.ts` stalls writer A between `release`'s `readInfo`
  and its removal — a hook alongside the existing `beforeTakeoverMove` / `beforeClaimWrite` — lets
  writer B take the lock over and claim it in that gap, and then asserts that B's `assertHeld` still
  passes and B's write lands. Reverting `release` to read-then-`rm` turns it red.
- The existing three cases stay green, unchanged: this touches the release path and must not move
  the takeover's behaviour.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`. The lock runs on
  both runtimes, so the Bun run is not optional here.
