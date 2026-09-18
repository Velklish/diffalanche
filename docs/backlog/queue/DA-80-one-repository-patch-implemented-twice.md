# DA-80 · "Patch one repository into diff.json under the lock" is implemented twice, in the change set and in the watcher

- **Order:** 220
- **Scope:** 02-git, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

One operation — read `diff.json` under the session lock, check that its base and scope still match, replace what it says about a single repository, write it back — exists in two places, and the two copies no longer agree.

[src/core/change-set.ts](../../../src/core/change-set.ts):236-240, inside `refreshRepository`:

```ts
const repositories = previous.repositories.filter((one) => one.path !== repo);
if (change.files.length > 0) repositories.push(change);
const warnings: ScanWarning[] = [
  ...previous.warnings.filter((one) => one.path !== repo),
  ...change.warnings.map((message) => ({ path: repo, message })),
];
```

[src/core/watcher/index.ts](../../../src/core/watcher/index.ts):453-463, inside `rescanRepository`:

```ts
const repositories = cached.repositories.filter((one) => one.path !== repo);
if (change.files.length > 0) repositories.push(change);
repositories.sort((a, b) => byCodePoint(a.path, b.path));

const warnings = [
  ...cached.warnings.filter((one) => one.path !== repo),
  ...scan.warnings.filter((one) => one.path === repo),
  ...change.warnings.map((message) => ({ path: repo, message })),
].sort((a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message));
```

The divergence is in the middle line of the watcher's list and in the sort. Warnings come from two sources: the repository read itself (`change.warnings`, which both copies keep) and the scan of the root (`scan.warnings`) — the worktree notice at [src/core/scanner/index.ts](../../../src/core/scanner/index.ts):154, which pushes `worktree of <main path>` against the linked worktree's path, and `in the scope of this review task, but not a repository under the root` at [change-set.ts](../../../src/core/change-set.ts):177-181. A repository read on its own produces neither. So `refreshRepository` filters the scan-level warning of the repository out and has nothing to put back: after it runs, the review has lost that warning. The watcher's copy re-adds it from `scan.warnings`, which is exactly the difference.

This is live on both sides. `refreshRepository` is reached by any line comment through the CLI — [src/cli/commands/comment.ts](../../../src/cli/commands/comment.ts):67 calls it whenever `--line` is given — and nothing repairs the cache afterwards: [src/server/review.ts](../../../src/server/review.ts):212-215 reuses a cache whose base and scope still match, and `/api/warnings` reads that same document. A root where a reviewed repository is a linked worktree therefore stops reporting it until a full rescan.

The sort is the second half. `cache()` at [change-set.ts](../../../src/core/change-set.ts):36-52 sorts the repositories and passes `warnings` through untouched, so the CLI path leaves the list in whatever order the concatenation produced. The next watcher rescan re-sorts it, and both order comparisons downstream are index-wise — `sameWarnings` at [watcher/index.ts](../../../src/core/watcher/index.ts):517-524 and the store's guard at [src/ui/store.ts](../../../src/ui/store.ts):1142 — so an order-only change reads as a new set. The watcher emits `{ type: "warnings" }`, and `setWarnings` then does `writeDismissed(null); set({ warnings, warningsDismissedFor: null })` ([store.ts](../../../src/ui/store.ts):1140-1148), which puts a warnings bar the reader had dismissed back on the screen with nothing new in it.

The reference already treats the watcher's version as the specified behaviour: [05-watcher.md](../../reference/05-watcher.md):241-244 says the list is sorted "so an unchanged set of warnings does not look like a new one", while the `refreshRepository` paragraph in [02-git.md](../../reference/02-git.md):262-274 says nothing about warnings at all. No test covers the difference — the only test that calls `refreshRepository` is the concurrency case at [tests/change-set.test.ts](../../../tests/change-set.test.ts):147-148, which asserts on files and never looks at `warnings`.

## Work to do

- Decide first which of the two copies is the contract. The watcher's is the documented one and the one that preserves scan-level warnings, but it needs a `ScanResult` to do it, which `refreshRepository` does not have and which its callers would have to obtain. The candidates are: have the shared helper take the scan-level warnings of the repository as a parameter that the CLI path fills by asking the scanner for the one repository it is about; carry the scan-level warnings in `DiffCache` in a form that survives a patch, so neither writer has to re-derive them; or keep the CLI copy warning-lossy and say so in the reference as deliberate. The first two close the bug, the third closes only the duplication.
- Extract the agreed version into one function and have both `refreshRepository` and `rescanRepository` call it. What is genuinely different between the two callers — the watcher's `sameChange` short-circuit and its `Rescan` outcome, the CLI's fall-through to a full scan when the base or scope no longer match — stays with the caller.
- Make the warnings list sorted at the single point where it is written, so no caller can produce an unsorted one. `cache()` is that point for the change-set path.
- Update [02-git.md](../../reference/02-git.md) and [05-watcher.md](../../reference/05-watcher.md) so one of them describes the shared operation and the other points at it, rather than each describing its own copy.

## Out of scope

- The index-wise comparisons themselves. Making `sameWarnings` and the store's guard order-insensitive would hide this symptom without closing the divergence, and the bar that pops back up is the subject of its own entry, [DA-79-dismissed-warning-hides-a-new-one.md](../../archive/DA-79-dismissed-warning-hides-a-new-one/task.md).
- The locking around these writes. Both copies already take the session lock; the writes that do not are [DA-67-two-writes-outside-the-session-lock.md](DA-67-two-writes-outside-the-session-lock.md).
- Whether a comment should trigger a repository re-read at all — that cost is [DA-88-a-refused-comment-has-already-rescanned.md](../../archive/DA-88-a-refused-comment-has-already-rescanned/task.md).

## Verification

- A test over a root where one repository is a linked worktree: scan, assert the `worktree of …` warning is in `diff.json`, run the CLI comment path with `--line`, assert it is still there. Deleting the re-add turns it red.
- A test that patches one repository into a cache whose warnings are out of order and asserts the written list is sorted by path then message, from whichever writer is used — the same assertion must hold for both callers.
- One implementation: `grep -n "warnings.filter((one) => one.path !== repo)" src/` finds one site.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`. The perf gate is not touched by this change, but `bun run perf` stays green because the watcher path is on its measured route.
