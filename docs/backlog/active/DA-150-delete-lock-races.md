# DA-150 · Validate deletion and lock waiter races

- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor
- **Previous order:** 860
- **Taken:** 2026-11-01

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Deterministic deletion/waiter interleavings with both ENOTEMPTY and EINVAL symptoms, common cause unproven.

## Work to do

- [DA-40.3 — The deleteSession verdict on a waiter of a deleted session's lock races the removal: ENOTEMPTY](../minor/DA-40.3-delete-waiter-races-rmsync.md)
- [DA-121.2 — The deleteSession lock race has a second symptom: EINVAL from the waiter's mkdir instead of NoSuchSessionError](../minor/DA-121.2-delete-session-race-einval.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-40.3

# DA-40.3 · The deleteSession verdict on a waiter of a deleted session's lock races the removal: ENOTEMPTY

- **Scope:** 03-storage
- **Created:** 2026-09-24
- **Parent:** DA-40
- **Cost:** minor

## Evidence

Finding discovered at the final gate series of the core3 track (DA-55.8, DA-60.2),
whose diff touches neither the storage, the domain nor this test.
`tests/sessions.test.ts > deleteSession > refuses a writer that waited on the lock
of a session deleted meanwhile, and makes no directory` failed once in `bun run
test` on `9e8c0af` (2026-09-24 04:30Z, load 12.4), the assertion in full:

```
Error: ENOTEMPTY, Directory not empty: …/diffalanche-sessions-D3KHjj/.diffalanche/reviews/gone '…/reviews/gone'
 ❯ tests/sessions.test.ts:308:7
```

It is on the base too. `npx vitest run tests/sessions.test.ts` under
`/tmp/da-perf.lock`, load 6–8: on `29e1872` red on the 58th of 58 runs, the same
verdict and the same `ENOTEMPTY`; on `9e8c0af` red in 2 of 18. The verdict alone
(`-t` with its name) was green twice on each side.

The test removes the session directory with `rmSync(dir, { recursive: true })`
inside the lock, right after it started a second `withLock` on the same directory:

<!-- quote:before:../../../tests/sessions.test.ts -->
```ts
    await withLock(dir, async () => {
      // Queued behind the lock this body holds, then left with no directory to lock.
      waiter = withLock(dir, async () => undefined).catch((caught: unknown) => caught);
      rmSync(dir, { recursive: true, force: true });
    });
```
<!-- /quote -->

A hypothesis, not traced: the waiter's `mkdir` of `.lock` has already gone to the
thread pool when the synchronous `rmSync` starts. If it lands after `rmSync`
removed the held `.lock` and before it removes the directory, it makes a new
`.lock`, and the final `rmdir` finds the directory not empty.

## What it would take

Trace which entry is left in `reviews/gone` when it fails. If it is `.lock`, the
test should remove the directory the way `removeSession` does, which is one
`rename` out of `reviews/`, so that no waiter can make anything inside it.


### Retained original DA-121.2

# DA-121.2 · The deleteSession lock race has a second symptom: EINVAL from the waiter's mkdir instead of NoSuchSessionError

- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-10-03
- **Parent:** DA-121
- **Cost:** minor (hypothesis)

## Evidence

Finding discovered while working on DA-121.

Evidence: tests/sessions.test.ts > deleteSession > refuses a writer that waited on the lock of a session deleted meanwhile, and makes no directory: AssertionError expected Error: EINVAL: invalid argument, mkdir … to be an instance of NoSuchSessionError at tests/sessions.test.ts:310:26 — seen twice by the DA-121 approver on 76f2277 and the squashed tree (1 full suite, 1 of 92 file runs), 0 of 212 file runs on a6d2ce8, where the ENOTEMPTY symptom of DA-40.3 reddened 6 of 212; every path 76f2277 changes is Markdown (2026-10-03, macOS, load 30-65 on 8 cores; evidence-approver-adr.md). Unverified that it is the same window as DA-40.3.

## Execution plan

Storage durability and lock-test track owns atomic.ts, storage-atomic/lock-writers/sessions tests and reference 03. Prefer deterministic filesystem/domain barriers, preserve separate source outcomes and validate hypotheses before changing production locks. Propagate real directory-open durability failures without changing Windows or durable:false policy. Do not implement deferred first-session-directory flush or UI/orphaned features.
