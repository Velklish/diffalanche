# DA-92 · The recursive-watch probe writes with no catch, so a failed write at start-up becomes an unhandled rejection

- **Order:** 470
- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`probeRecursiveWatch` fires two writes at the same path and handles them differently. The repeated one, inside the interval, swallows its own failure; the first one, at the end of the probe, does not:

[src/core/watcher/tree.ts](../../../src/core/watcher/tree.ts), lines 225–239

```ts
      const writing = setInterval(() => {
        void writeFile(join(nested, "deep"), `probe ${Date.now()}`).catch(() => undefined);
      }, PROBE_WRITE_MS);
      try {
        watcher = watch(probe as string, { recursive: true, persistent: false }, (_e, name) => {
          if (name !== null && String(name).includes("deep")) done(true);
        });
      } catch {
        clearTimeout(timer);
        clearInterval(writing);
        resolve(false);
        return;
      }
      watcher.on("error", () => done(false));
      void writeFile(join(nested, "deep"), "probe");
```

The `try { … } catch { return false; } finally { … }` that wraps the whole probe (tree.ts:205–245) cannot see line 239 either: the `void` detaches that promise from the `new Promise<boolean>` the try block awaits, so a rejection escapes the function entirely. Nothing catches it further out — `grep -rn "process\.on" src/` returns nothing, so there is no `unhandledRejection` handler in the process.

Both supported runtimes treat an escaped rejection as fatal. Reproduced on Node v25.2.1 and Bun 1.3.14 with a two-line script (`void Promise.reject(new Error("boom"))` plus a timer): both printed the error and exited 1, the timer never ran.

The probe is on the start-up path of every server — `src/core/watcher/index.ts:114` calls `supportsRecursiveWatch(config.dataDir)` and `src/server/serve.ts:81` calls `startWatcher` — so a write that fails there aborts `diffalanche serve` mid-start instead of answering the question. The answer it should give in that case is already written down: [docs/reference/05-watcher.md](../../reference/05-watcher.md) says a watch that cannot be trusted "closes itself and the walk takes over, rather than ending the process with an unhandled event", and the polling fallback (tree.ts:111–148) is what `done(false)` at the timeout and the `catch` at tree.ts:241 exist to reach.

The trigger is narrow, which is why this is minor: `mkdir` and `mkdtemp` have already succeeded on the same directory by the time line 239 runs, so the write fails only on a condition that appears between them — ENOSPC on a full disk, EIO, EDQUOT on a quota'd home. The teardown race is not a second trigger: line 239 is issued synchronously before any watcher callback can resolve `done(true)`, so the `finally`'s `rm` cannot precede the open, and on POSIX an unlinked file's descriptor stays valid anyway.

## Work to do

- Give the write at tree.ts:239 the same treatment as the one at tree.ts:226, or a stronger one. There is a decision to make first: swallowing the error (`.catch(() => undefined)`) leaves the probe to time out after `PROBE_TIMEOUT_MS` and answer `false`, while `.catch(() => done(false))` answers immediately. The second starts the server sooner on a filesystem that is already refusing writes; the first matches the neighbouring line exactly and adds no new path. Both are defensible — `done` is in scope at line 239 either way — so pick one and let the two-line comment there say why ([ADR-011](../../adr/adr-011-comment-length.md)).
- Decide, in the same pass, about the three neighbours the same grep finds outside the UI. `grep -rn "^\s*void [a-zA-Z]" src/core src/server | grep -v catch` returns tree.ts:239 plus `src/server/events.ts:171`, `:178` and `:196`; the two `void write(…)` are safe — `write` attaches its own rejection handler at events.ts:158–165 — while `void stream.close()` at events.ts:178 is detached the same way this entry is about. Either it is covered here or it becomes its own entry, but it is not left unexamined.
- Whatever is chosen, the probe's contract stays "returns a boolean, never throws" — that is what `supportsRecursiveWatch` promises its one caller, which has no error path of its own.

## Out of scope

- The polling fallback itself, its interval, and the walk's cost. This entry only makes the probe reach it.
- Anything about `serve` surviving other start-up failures — an unreadable data directory is DA-64, filed separately.
- A process-level `unhandledRejection` handler. That would hide this class of bug rather than fix it, and adding one is a decision about the whole binary, not about the probe.

## Verification

- A test that makes the probe's first write fail — the simplest is a `dir` on a path where `nested` can be created but the file cannot, otherwise a stub of `writeFile` — sees the probe resolve `false` and the process still running. Removing the new `.catch` turns that test red with an unhandled rejection rather than an assertion failure, which is the point: the current code kills the runner. The exported entry point cannot be the one under test, because `supportsRecursiveWatch` memoizes in `probed` (tree.ts:200) and `tests/watcher.test.ts:766` has already cached `true` for the process — so either `probeRecursiveWatch` is exported for the test, or the memo gets a reset the test can call. Choosing between those two is part of the work.
- `tests/watcher.test.ts` still passes under both runtimes, including the `recursive: false` path Bun's runner uses.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`.
