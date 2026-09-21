# DA-68 · Session identity is not carried through live frames and store loads, so a window on a task reacts to another session's events

- **Order:** 130
- **Scope:** 08-ui, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

Since DA-55 a window can be opened on a task that is not `current`, and decision 7 of [ADR-010](../../adr/adr-010-review-task-scope.md) says that is the normal case rather than the exception. Three places in the page still assume there is only one review: the comment frames, the diff patch and `loadReview` itself. None of them carries the name of the task the data belongs to, and all three are reachable from one window.

**The frames have no session name.** The wire shape is in [src/core/watcher/bus.ts:17-20](../../../src/core/watcher/bus.ts) and carries ids only:

```ts
// src/core/watcher/bus.ts:17
  | { type: "comment-added"; id: string }
  /** `id` is the reply, `commentId` the thread it landed in. */
  | { type: "reply-added"; id: string; commentId: string }
  | { type: "comment-status"; id: string }
```

They are emitted from `reloadComments`, which reads one session — `readCurrent`'s ([src/core/watcher/index.ts:288-291](../../../src/core/watcher/index.ts)), the stream is global with no per-connection filter ([src/server/events.ts](../../../src/server/events.ts)), and [src/ui/live.ts:78-86](../../../src/ui/live.ts) subscribes with no guard at all — unlike `session-changed` six lines further down, which does hold one: `const held = store().reviewName; if (held !== null && held !== event.name) return;` (live.ts:93-94). `thread()` then fetches `onTask('/api/comments/<id>')` (live.ts:166), `onTask` appends this window's `?review=` (store.ts:1700-1704), the domain refuses with `no-such-comment` ([src/core/domain/comments.ts:208](../../../src/core/domain/comments.ts)), `statusOf` maps it to 404 ([src/server/errors.ts:63-71](../../../src/server/errors.ts)), and the queue's catch turns the throw into a toast (live.ts:45-51). A window on `?review=ls-7` therefore shows *«the thread c_… could not be read: the server answered 404»* for every comment, reply and resolve an agent writes in the current session.

The silent half of this — a window on a named task hearing nothing about its **own** threads — is already [DA-55.1](../DA-55.1-watcher-follows-one-session/task.md), and [08-ui.md:166-170](../../reference/08-ui.md) documents it. That prose is slightly wrong in a way that matters here: it says the frames "never name a thread of another task", and what happens is that they do arrive and 404. Fixing DA-55.1 as it is written does not remove the toast: a watcher following several sessions emits more of these ids, not fewer, and the frames still say nothing about which session they came from.

**The diff patch is applied to whoever is in the store when it lands.** `diffChanged` stamps the task at request time and never re-checks it (live.ts:143-152), and `applyRepositoryDiff` takes no session argument; when the repository is unknown to the review on screen it *appends* it (store.ts:1186-1189, `at < 0 ? [...repositories, merged].sort(...)`). There is no `AbortController` anywhere in `src/ui`. So a task switch while a repository diff is in flight merges the current session's change set into the task the reader switched to — a repository section that is not in that task's scope, computed against another base, with the composer usable on its lines.

**`loadReview` has no request generation.** store.ts:528-546 awaits `fetch(onTask("/api/review"))` and whichever response resolves last wins; `fromDocument` writes `session: document.session` (store.ts:1507) and never touches `reviewName`. A late response therefore leaves the two naming different tasks — and every write route is stamped from `reviewName`, not from the review on screen: `submitComment` (store.ts:965), `write` (store.ts:1435), `thread`. A comment written on a visible line then lands in a session that does not contain that line. The finder's trigger was double-clicking the history menu; that one is refuted, because `switchSession` is gated by `switching` (store.ts:704-706). What is reachable is `syncTaskFromUrl`, which checks the name and nothing else (store.ts:563-568, wired to `popstate` at [src/ui/App.tsx:41-43](../../../src/ui/App.tsx)) and a stream-driven `loadReview` from live.ts:99 or live.ts:119 overlapping a user switch.

## Work to do

- Decide where session identity is enforced, and say so in [07-server.md](../../reference/07-server.md) once it is decided. Two candidates: the frames carry the session name — `bus.ts` gains it on the three comment events, the watcher fills it, and live.ts guards the way `session-changed` already does — or the stream is opened with `?review=` and `events.ts` filters per connection. The first keeps one stream per server and moves the decision to the client; the second makes a window's subscription say what it is for, at the cost of the frames no longer being one broadcast.
- Give `loadReview` a generation counter or an `AbortController` held in the store, so a response that belongs to a task the window has left is dropped instead of applied. Whatever is chosen has to cover the callers that are not gated by `switching`: `syncTaskFromUrl`, and both stream handlers.
- Make `applyRepositoryDiff` take the session the diff was fetched for and drop a patch whose session is no longer the one on screen. The append branch at store.ts:1186-1189 is the one that does visible damage, but a merge into the wrong repository of the wrong task is the same class.
- Decide what a window does about `reviewName` and `session.name` disagreeing at all — whether that state should be representable. Making the pair one value is a larger change than dropping stale responses and should be weighed rather than assumed.

## Out of scope

- Teaching the watcher to follow more than one session: that is [DA-55.1](../DA-55.1-watcher-follows-one-session/task.md), and this task has to work whether or not it lands.
- The stale change set a named task's document is built from, which is [DA-55.3](../DA-55.3-named-task-document-is-stale/task.md).
- The scope editor reading candidates from the wrong session, filed as [DA-77](../DA-77-scope-editor-picks-from-the-wrong-session/task.md).

## Verification

- Two windows, one on `current` and one on `?review=<other>`: a comment, a reply and a resolve written into the current session produce no toast and no request in the second window. Removing the guard turns that test red.
- A `diff-changed` response for a repository outside the second task's scope, delivered after a switch, leaves the repository list unchanged — asserted on the store, so it does not need a browser.
- Two overlapping `loadReview` calls, the slower one for the task that was left, end with `reviewName` and `session.name` naming the same task, and a comment submitted afterwards carries that task's `?review=`.
- Gates on the touched code: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, and `bun run perf` for the live-update budget the new guard sits inside.
