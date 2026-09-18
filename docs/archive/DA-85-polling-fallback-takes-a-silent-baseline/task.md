# DA-85 · When the native recursive watch dies mid-session the polling fallback takes a fresh silent baseline

- **Scope:** 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

The recursive watch can fail after it has started — an error from inotify or FSEvents, `ENOSPC` on a Linux tree large enough to exhaust `fs.inotify.max_user_watches` being the realistic one. The handler closes the watch and hands the tree to the walk:

[src/core/watcher/tree.ts:99-102](../../../src/core/watcher/tree.ts)

```ts
watcher.on("error", () => {
  watcher.close();
  onFailure();
});
```

[src/core/watcher/tree.ts:64-69](../../../src/core/watcher/tree.ts)

```ts
/** A watch that fails after it started leaves the tree unwatched; the walk takes over. */
function fallBack(): void {
  if (closed || current?.polling === true) return;
  current?.close();
  current = polling(options);
}
```

`polling()` opens with a baseline, and a baseline is silent by construction:

[src/core/watcher/tree.ts:136-138](../../../src/core/watcher/tree.ts)

```ts
// The first walk is the baseline: what is already on disk is not a change.
const ready = tick(false);
const timer = setInterval(() => void tick(true), interval);
```

With `report === false` the comparison loop at `tree.ts:122-129` is skipped and only `previous = next` (`:130`) runs. That is correct at startup — the walk's guarantee, written out at [docs/reference/05-watcher.md:34-37](../../reference/05-watcher.md), is exactly that "a change made before that baseline exists would be part of it rather than a change" — and it is wrong here, because at takeover the tree was already being watched and the caller has long been told the server is live. Every file written between the error and the end of that walk is folded into `previous` and produces no `onChange`, so no `diff-changed` is emitted for it. On a tree big enough to have exhausted the watch descriptors, the walk is not instant.

Nobody waits for the replacement's baseline and nobody can. `watchTree` captured the promise once, at construction:

[src/core/watcher/tree.ts:73](../../../src/core/watcher/tree.ts)

```ts
const ready = current.ready;
```

so the `ready` returned to callers is the dead watcher's, and `startWatcher`'s `await Promise.all(watchers.map((watcher) => watcher.ready))` ([src/core/watcher/index.ts:372](../../../src/core/watcher/index.ts)) has already resolved by the time `fallBack` runs.

The degradation is also invisible. `Watcher` exposes `polling()` at [src/core/watcher/index.ts:95](../../../src/core/watcher/index.ts) and implements it at `:376`, and `grep -rn polling src/` returns only those two lines plus the `TreeWatcher` definitions in `tree.ts` — nothing in the server, the CLI or the UI reads it, and `tests/watcher.test.ts:810` is its only caller anywhere. So a session that has dropped to a 250 ms walk says nothing on stderr and nothing on screen.

The miss self-heals, but only sideways: a later change anywhere in the same repository triggers a rescan that picks the lost edit up. A repository whose only change fell inside the window keeps showing the pre-edit diff for the rest of the session. That, plus the narrow trigger, is why this is minor rather than major. [docs/reference/05-watcher.md:74-76](../../reference/05-watcher.md) documents the takeover itself and says nothing about its blind window; the passage at `:81-89` is about the gap between `watch()` returning and the first delivery, which is a different window and the reason the walk has a baseline at all.

## Work to do

- Decide what the replacement walk's first tick means, and the decision comes before the code. Two candidates: **report from the start** — have `fallBack` pass a flag that makes `polling()` open with `tick(true)` against a snapshot carried over from before the failure, so files changed during the takeover are reported; or **re-announce** — keep the silent baseline and emit a change for every repository the tree covers once it completes, which over-reports rather than under-reports. The first needs the native path to have a snapshot to hand over, which it does not today; the second is cheap and lands as one rescan per repository.
- Whichever is chosen, make the replacement's `ready` observable. `watchTree` currently freezes the first `ready` at `tree.ts:73`; a caller that wants to know when the tree is genuinely covered again needs the live one, not the dead watcher's.
- Surface the takeover once it happens. `Watcher.polling()` already exists and has no consumer; decide whether it gets one (a line on stderr from `serve`, a flag on the SSE stream, a marker in the UI's live-status area) or whether the signal should be an event rather than a poll. Leaving both the accessor unused and the degradation silent is the one outcome this task does not accept.
- Write the takeover down in [docs/reference/05-watcher.md](../../reference/05-watcher.md) next to the existing sentence at lines 74-76: what the walk does with the window, and what the operator sees.

## Out of scope

- The startup window at `05-watcher.md:81-89` — the gap between `watch()` returning and the first delivery. It is documented, it is a different mechanism, and the probe that covers it is not touched here.
- Making the recursive watch survive `ENOSPC`, raising `fs.inotify.max_user_watches`, or watching fewer directories. This entry is about what happens after the watch is gone.
- DA-59, the dead-code sweep. `Watcher.polling()` is unused today, but it is unused *because* this hole is unfilled; whether it is removed or wired up is decided here, and the sweep should not reach it first.
- DA-86, a broken `comments.json` stalling the watcher, and DA-92, the watch probe's uncaught write — both in this subsystem, both filed on their own.

## Verification

- A test drives the failure rather than waiting for it: build a tree watcher with the recursive path, emit `error` on the underlying watcher (or inject a failing `native`), write a file while the replacement's first walk is in flight, and assert an `onChange` for that path. That test is red against today's `tree.ts` — the write is absorbed into the baseline — and green after the change.
- A second check pins the reporting decision itself, so a later "optimisation" back to a silent first tick turns it red.
- Whatever surfaces the degradation has a caller in `src/`, and `grep -rn polling src/` no longer shows the accessor with no consumer — or shows it gone.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`. `test:bun` matters here in particular — under Bun's runner `tests/watcher.test.ts` exercises the walk rather than the watch (`05-watcher.md:92-98`), so a change to `polling()` is covered differently on the two runtimes.
