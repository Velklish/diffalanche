# DA-152 · Reconcile review documents, streams and history deletion

- **Scope:** linked source scopes; [reference](../../reference/README.md)
- **Created:** 2026-11-01
- **Dependencies:** retain each source condition below
- **Cost:** minor
- **Previous order:** 880
- **Taken:** 2026-11-01

## Context

Authorized consolidation of original minor entries. This batch is an execution group, not a declaration of duplicate causes. Document/stream handover scenarios and deletion event propagation. Do not conflate DA-127 or named path-scope major.

## Work to do

- [DA-55.10 — A frame sent between a window's document and its stream misses that window when the task is already followed](minor/DA-55.10-followed-task-frame-between-document-and-stream.md)
- [DA-55.11 — A window's stream does not say which document its window holds, so the watcher's baseline of its task is a guess](minor/DA-55.11-stream-knows-its-served-document.md)
- [DA-55.12 — A switch of task drops the task's frames until its document arrives, and a write between the two reaches neither](minor/DA-55.12-switch-drops-frames-before-document.md)
- [DA-40.2 — A menu open in another window keeps the row of a task deleted elsewhere until it is opened again](minor/DA-40.2-menu-keeps-a-task-deleted-elsewhere.md)

Preserve a separate verdict, regression check and evidence for every source ID. Validate each hypothesis before choosing a fix; no reproduction is not refutation. New findings do not expand the authorized set.

## Out of scope

All original deferred implementation and unrelated product work. No push, release or tag.

## Verification

Every original source requirement and Verification below remains mandatory. Run configured gates and meaningful mutation probes for changed tests; keep exact command, cwd, base/head, exit and raw logs. Independently review the final SHA. Archive source minors into this batch only at actual batch acceptance.

## Retained source requirements

### Retained original DA-55.10

# DA-55.10 · A frame sent between a window's document and its stream misses that window when the task is already followed

- **Scope:** 05-watcher, 07-server
- **Created:** 2026-09-24
- **Parent:** DA-55.8
- **Cost:** minor (hypothesis)

## Evidence

Finding discovered while working on DA-55.8. **Read from the code, not
reproduced.**

DA-55.8 closed the gap between a window's document and its stream for a task the
watcher does not follow yet: the burst that starts following it compares with
what the window was served. A task the watcher already follows — the current
one, or one another window is on — keeps its own snapshot, and what was served
of it is dropped by the next burst that follows it:

<!-- quote:before:../../../src/core/watcher/index.ts -->
```ts
    reloadMetadata(followed, reviews);
    for (const name of followed) served.delete(name);
```
<!-- /quote -->

So on a **first load** a write that lands after the window's document was read
and whose burst ends before the window's stream is subscribed goes out as a frame
to the windows open then, and not to this one; a new client gets no replay
([07-server.md](../../reference/07-server.md#the-live-stream)). A first load asks
for the document and opens the stream together (`src/ui/App.tsx`, "The stream is
opened after the first read is asked for"), so the gap is the time between the
document being served and the stream request being handled — short when the
document is held and served at once, and not bounded by anything.

A **switch of task** opens the stream first and asks for the document after
(`src/ui/store.ts` sets the task, `src/ui/live.ts` reconnects on it), so the gap
above does not arise there: a write whose frame lands before the document is also
in the document. What a switch has instead is the page dropping the task's frames
until its document arrives, which is DA-55.12.

## What it would take

Reproduce first, on the first-load order: a window on `current`, its document
served, a write and its frame on another stream, then the window's stream opened
— the frame is not on it and the document does not have the write. A fix belongs to the page or to the
stream rather than to the watcher's baseline, which is one per task and cannot be
two windows' at once: the page opening its stream before it reads the document,
or reading the document again when the stream says it is connected.


### Retained original DA-55.11

# DA-55.11 · A window's stream does not say which document its window holds, so the watcher's baseline of its task is a guess

- **Scope:** 05-watcher, 07-server, 08-ui
- **Created:** 2026-09-24
- **Parent:** DA-55.8
- **Cost:** minor

## Evidence

Finding of the review of DA-55.8, filed from its worker at the orchestrator's
decision.

DA-55.8 made the burst that starts following a task compare with the oldest
document served of it since it was last followed, kept per task in the watcher,
looked up after the burst reads the files, and dropped when the last stream on
the task ends ([05-watcher.md](../../reference/05-watcher.md#events)). The stream
that makes the watcher follow the task says only the task's name
(`GET /api/events?review=<name>`), so which document its window holds is
inferred, and three corners stay open, beside one frame that can be wrong for a
moment:

- a document whose window closed before its stream opened has no stream to end:
  it is the baseline of the next window whose stream opens before its own
  document (a switch of task), and a write made in between, while no window was
  on the task, reaches that window as a frame and a feed line although it is
  history;
- a stream whose end reaches the server after the next window's document — a
  reload whose old connection is torn down late — drops that document, and the
  new window is compared with the files the burst reads: a write between its
  document and that burst reaches it on reload only;
- a document served while another window held the task is not the baseline at
  all: that task keeps its own snapshot, and a frame between the window's
  document and its stream misses it (DA-55.10);
- a document served while the burst reads the files can be newer than that read:
  a comment added in that moment is in the window's document and still comes as a
  frame from the next burst, and one deleted in that moment is announced once and
  found gone when the window reads its thread; nothing is lost.

## What it would take

Let the stream name its document: `payload()` hands the window a token for the
document it served — what the watcher keeps of that document is kept under the
token — and the page opens its stream with `?served=<token>`. The watcher then
compares the task with exactly that window's document when the stream brings it
into the followed set, and a stream with no token (a reconnect) keeps the silent
baseline. It touches `src/ui/live.ts` and the review response, so it is a change
for the UI track as well as for the server.


### Retained original DA-55.12

# DA-55.12 · A switch of task drops the task's frames until its document arrives, and a write between the two reaches neither

- **Scope:** 08-ui, 05-watcher
- **Created:** 2026-09-24
- **Parent:** DA-55.8
- **Cost:** minor (hypothesis)

## Evidence

Finding of the review of DA-55.8, filed from its worker. **Read from the code, not
reproduced.**

A switch of task sets the task and reads its review after (`showTask` and
`syncTaskFromUrl` in `src/ui/store.ts`: `set({ reviewName: name })`, then
`await get().loadReview()`), and the new task name reconnects the stream at once
(`startLive` in `src/ui/live.ts` subscribes to `reviewName`). Until the document
arrives, the store's `session` is still the task the window left, and the comment
frames of the new task are dropped as somebody else's:

<!-- quote:../../../src/ui/live.ts -->
```ts
function onScreen(session: string): boolean {
  const shown = useStore.getState().session?.name ?? null;
  return shown === null || shown === session;
}
```
<!-- /quote -->

Since DA-55.8 the burst that starts following the task compares with the document
the server served, taken in `payload()` before it is serialised. A write that lands
after that document's comments were read, and whose burst ends before the page has
applied the response, goes out as a frame the page drops — the document is still
the old task's — and is not in the document the page then applies. The write
reaches the window on the next reload.

## What it would take

Reproduce first: switch a window to a task whose document is large enough to take
a while to serialise and send, and `addComment` into it right after the server
answered, before the page applies it. A fix belongs to the page: holding the new
task's frames until its document is applied rather than dropping them, or reading
the thread a dropped frame named once the document has arrived.


### Retained original DA-40.2

# DA-40.2 · A menu open in another window keeps the row of a task deleted elsewhere until it is opened again

- **Scope:** 05-watcher, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-24
- **Parent:** DA-40.1
- **Cost:** minor

## Evidence

Finding discovered while working on DA-40.1, which closed the shape that strands a window: a
window whose own task is gone answers `no-such-session` by moving to `current`, and a press on
a row whose task is gone lands there too and reads the history again. What stays is the row
itself, in a sessions menu that is open in another window while the task is deleted — by the
CLI or by a third window. The watcher compares the statuses of the sessions it lists, and a
session that is no longer listed produces no frame, because `sessions-changed` carries a
`status` and there is none for "gone":

<!-- quote:before:../../../src/core/watcher/index.ts -->
    for (const [name, status] of next) {
      if (sessions.get(name) !== status) bus.emit({ type: "sessions-changed", name, status });
    }
<!-- /quote -->

So the row stays until the menu is opened again, or pressed. The fix is a frame for a session
that disappeared — a change to `WatcherEvent` and to the three frame tables
`tests/frame-tables.test.ts` holds, in the watcher's and the server's files — which the brief of
DA-40.1's run gave to the orchestrator to decide rather than to the UI track. Read off the code
on `660190b`; the stale row itself was not reproduced in a browser.

DA-40.1's e2e met a neighbouring gap once, in a full `test:ui` run on `fcf4214` (the window
stayed on `ls-delete-elsewhere`, `watching`, no toast within 20 s; green when run alone): the
watcher takes the metadata baseline of a task a window follows on the first data-directory burst
after the window subscribed, and says nothing on that burst, so a delete that is that burst sends
no `session-changed`. That gap is not this entry's: it is closed by DA-55.8 (track core3), whose
baseline is the document handed to the window. Until it lands the e2e writes a comment and waits
for it in the rail before it deletes; once it has landed, the test can wait without that marker.

## Owner workflow update — 2026-11-01

The owner explicitly authorized closing implementation-complete cards after their specific AC and independent review, while shared integration/test/performance quality acceptance is retained in DA-156. This later workflow changes the earlier acceptance sequence, not product budgets, guards, assertions or the original requirements. This implementation closure does not claim a full eight-gate pass or final quality acceptance. The current session stops after ready integration and handoff; DA-156 is for the new session.
