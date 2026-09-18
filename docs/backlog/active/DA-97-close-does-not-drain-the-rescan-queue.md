# DA-97 · Watcher.close does not drain the in-flight rescan queue, so the server resolves closed while work continues

- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

`Watcher.close` is synchronous and stops only what has not started yet. In [src/core/watcher/index.ts](../../../src/core/watcher/index.ts) it is four statements:

```ts
// src/core/watcher/index.ts:377-382
close: () => {
  closed = true;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  for (const watcher of watchers) watcher.close();
},
```

The `closed` flag is read in two places, and both are before the work rather than during it: in the debounce callback (index.ts:140, `if (!closed) run()`) and at the head of a queued item.

```ts
// src/core/watcher/index.ts:153-156
queue = queue.then(async () => {
  if (closed) return;
  try {
    await work();
```

An item already inside `await work()` therefore runs to the end. That work is `rescanRepository`, which takes the session lock and writes: `await writeDiffCache(config.dataDir, session, cache)` at index.ts:478 and again at 488, and `writeDiffCache` begins with `ensureSessionDir` (`src/core/storage/index.ts:195`), which is a `mkdir` with `recursive: true`. Nothing awaits `queue`, and nothing can: `queue` is a local (index.ts:124) and the type exposes `close: () => void` (index.ts:96).

The server inherits it. `src/server/serve.ts:128-134` awaits the socket and nothing else:

```ts
close: async () => {
  events.close();
  watcher.close();
  await server.close();
},
```

So `await server.close()` can resolve while a rescan is still holding the lock and about to write. The consequence lands on teardown, where the directory is removed right after. `tests/watcher.test.ts:278-281` is the shape of it:

```ts
afterAll(() => {
  watcher?.close();
  rmSync(root, { recursive: true, force: true });
});
```

A rescan that is mid-flight there either re-creates `<dataDir>/reviews/<name>/` after the tree was removed, or fails with ENOENT into `options.onError` — which, under the server, is a `process.stderr.write` (`src/server/serve.ts:87-91`) attributed to whatever runs next. The lock directory can be left behind the same way, and the next writer waits out `DEFAULT_STALE_MS`, 30 s (`src/core/storage/lock.ts:18`).

Production is largely out of reach of this: `serve` never calls close — `src/cli/commands/serve.ts` returns 0 and leaves the socket holding the process, and there is no `SIGINT` or `SIGTERM` handler anywhere in `src/` (`grep -rn "SIGINT\|SIGTERM" src/` is empty), so Ctrl-C ends the process outright. The exposure is the test and e2e teardown paths, which is why this is minor — and those paths are the CI gate.

## Work to do

- Make `close` await the queue. Setting `closed` first and then awaiting the chain is sound as it stands: the timers are cleared before the await, and a filesystem event arriving during it goes through `schedule`, whose callback checks `closed` before enqueueing anything. The chain never rejects — `enqueue` already swallows the failure into `onError` — so the drain does not need its own catch.
- Decide how the signature changes, because it is a contract. The candidates are `close: () => Promise<void>` on `Watcher` (index.ts:96), which makes every caller await, and a separate `drain()` beside a `close` that stays synchronous, which leaves the callers that do not care alone. The first is one way to close and the second is two.
- Carry the decision through the callers: `src/server/serve.ts:132` inside a close that is already `async`, `src/server/serve.ts:120` on the failed-listen path, where the close has to be awaited before the error is thrown, and `tests/watcher.test.ts:279`, `:793` and `:819`.
- Say in [docs/reference/05-watcher.md](../../reference/05-watcher.md) what closing now guarantees — that no write into the data directory follows a resolved close — and add the CHANGELOG line. That sentence is the contract a teardown is allowed to rely on.

## Out of scope

- The polling walk of `src/core/watcher/tree.ts`, whose `tick` can also be in flight when `close` returns. It reads (`snapshot` is `readdir` and `stat`), it writes nothing into the data directory, and closing it is a second decision about a different loop.
- Adding a signal handler so that the production `serve` closes at all. That is the reason this is minor rather than major, and it is a product decision, not this one.
- The lock's own staleness and takeover (`src/core/storage/lock.ts`), and DA-89, the stale lock that outlives the wait. A left-behind lock is a symptom here, not the subject.
- DA-60's list of structural flakiness in the suites, which does not include this one.

## Verification

- A test starts a watcher, provokes a rescan, calls close while the rescan is inside `work()`, and asserts that nothing is written after close resolves — with a spy on the clock or a probe that records the last write, not a sleep. Removing the drain turns it red.
- The write-after-teardown failure is gone the way it appears: with the drain reverted, a rescan in flight at `afterAll` re-creates the session directory under a removed root; with it in place, the root stays removed after close resolves.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`. Both runners are listed because the watcher's timing differs between them — the suite's own comment at `tests/watcher.test.ts:289-290` notes macOS coalescing file events under Bun — and a drain that only holds on one of the two is not a drain.
