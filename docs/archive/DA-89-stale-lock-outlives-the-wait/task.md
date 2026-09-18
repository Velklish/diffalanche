# DA-89 · A lock left by a killed writer is never taken over: the wait is a third of the lease

- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The session lock has two defaults that do not fit each other. A writer waits ten seconds for the
lock; a holder claims it for thirty.

[src/core/storage/lock.ts:15-18](../../../src/core/storage/lock.ts)

```ts
/** How long a writer waits for the lock before it gives up. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** How long a holder claims the lock for; past that another writer takes it over. */
const DEFAULT_STALE_MS = 30_000;
```

The takeover is the only way a lock left by a dead holder ever goes away — `takeOverIfStale` at
lock.ts:130-133 returns without doing anything until `Date.now()` passes the holder's recorded
`expiresAt`, and the waiting loop gives up on its own deadline first (`deadline = Date.now() +
timeoutMs`, lock.ts:63; the throw at lock.ts:66-69). A waiter that starts `t` seconds after the
holder died has until `t + 10`, and the takeover needs `30`, so every waiter with `t < 20` hangs the
full ten seconds and then refuses with a message naming a writer that is not there.

The claim is not that the lock is never taken over. It is that the takeover is unreachable for the
first twenty seconds, and self-healing after thirty. Reproduced on node v25.2.1, driving the real
`withLock` against a hand-written `.lock` whose holder died five seconds ago (exit 0 both times):

```
REFUSED after 10096 ms: /var/folders/…/da-lockprobe-w66omJ/.lock: held by another writer for over 10000 ms
```

and the same probe with two seconds of lease left instead of twenty-five:

```
ACQUIRED after 2117 ms
```

A lock is left behind whenever a writing process dies without running the `finally { release }` of
lock.ts:74-78. Nothing catches that: `grep -rn "process\.on\|process\.once\|SIGINT" src` exits 1,
so Ctrl-C on `diffalanche comment`, an OOM kill, or a crashed `serve` all leave `.lock` on disk with
a lease in the future.

The behaviour the code and the docs describe is the one the defaults make unreachable. The docblock
at lock.ts:37-41 says "a process killed mid-write blocks the next one for that long and no longer",
and [docs/reference/03-storage.md:111-114](../../reference/03-storage.md) repeats it: "past that
instant the holder is gone and the lock is taken over, so a process killed mid-write blocks the next
one for `staleMs` and no longer". With the defaults the next writer does not block for `staleMs`; it
blocks for `timeoutMs` and then fails.

No test exercises a takeover with the default lease. The two tests that involve staleness pass an
explicit `staleMs` of 10 (tests/storage.test.ts:284 and 385), and the takeover test at
tests/storage.test.ts:390-397 plants a lock that expired sixty seconds ago — the `staleLock` helper,
tests/storage.test.ts:53-64 — which is taken over on the first attempt and never reaches the
arithmetic.

## Work to do

- Decide what relationship between the two values the lock is supposed to have, and write it down
  where the constants are. The candidates are: make the wait at least the lease (`timeoutMs >=
  staleMs`, so a waiter always outlives the holder's claim); shorten the lease to fit inside the
  wait, which costs a body that legitimately runs long; or leave both and let the waiter extend its
  own deadline to the `expiresAt` it reads out of the lock, bounded by something, so it waits for a
  takeover it can actually reach instead of for a clock it cannot.
- Whichever is chosen, make the invariant checkable rather than a comment — the two constants are
  one decision and a future edit to either must not be able to reintroduce the gap.
- Make the refusal say what the waiter knows. `held by another writer for over 10000 ms`
  (lock.ts:66-69) is wrong in exactly this case; the lock's `info.json` carries the holder's pid and
  `expiresAt`, and naming them turns an unexplained ten-second hang into a readable answer.
- Bring lock.ts:37-41 and docs/reference/03-storage.md:111-114 into line with what the code does
  once it is decided, including the options table at 03-storage.md:98-101.
- Cover the defaults with a test that plants a lock with most of its lease left and asserts what the
  decision says should happen, instead of only the already-expired case.

## Out of scope

- The missing signal handler. Releasing the lock on SIGINT would make the situation rarer, not
  impossible — `kill -9` and an OOM kill leave no chance to run anything — so the lock has to
  survive a holder that vanishes regardless. That is a separate decision and has no file yet.
- The release path, which is filed as [DA-78](../DA-78-lock-release-is-not-atomic/task.md): its read and its
  `rm` are two steps. This entry does not touch `release`.

## Verification

- A test plants a `.lock` whose `expiresAt` is most of a lease away, calls `withLock` with no
  options, and asserts the decided outcome; changing either constant so the gap reopens turns it
  red.
- The refusal thrown in that state names the pid and the deadline it read, and a test asserts it.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` are green; `bun run perf`
  is unaffected but is part of the gate set.
- docs/reference/03-storage.md and the docblock no longer promise a takeover the defaults cannot
  reach.
