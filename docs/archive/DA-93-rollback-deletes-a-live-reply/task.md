# DA-93 · Rolling back a failed thread write restores a snapshot taken before a live patch, deleting an agent's reply

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

Every write on a thread — `Reply`, `Resolve`, `Reopen` — goes through one function, and its rollback restores an object captured before the request was sent:

[src/ui/store.ts](../../../src/ui/store.ts), lines 1431–1447

```ts
  const before = get().comments.find((comment) => comment.id === id);
  if (before === undefined) return false;
  set({ busy: { ...get().busy, [id]: true }, ...replace(get, id, optimistic(before)) });
  try {
    const response = await fetch(onTask(route), { … });
    if (!response.ok) throw new Error((await refusal(response)).message);
    const answered = (await response.json()) as Comment;
    set({ busy: without(get().busy, id), ...replace(get, id, answered) });
    return true;
  } catch (error) {
    set({ busy: without(get().busy, id), ...replace(get, id, before), toast: reason(error) });
    return false;
  }
```

`before` is the thread as it stood at the top of the call. Nothing keeps it current across the `await`: the live update writes the same thread through a path with no `busy` check —

[src/ui/store.ts](../../../src/ui/store.ts), line 1205

```ts
  patchThread: (comment) => {
    const comments = get().comments;
    const held = comments.some((one) => one.id === comment.id);
```

— and `src/ui/live.ts:173` calls it for every `reply-added` and `comment-status` frame, after fetching the server's own copy of the thread. Compare the entry checks the writers do have: `sendReply` refuses to start on a busy thread at `store.ts:1031` (`if (text === "" || get().busy[id] === true) return;`) and `setStatus` at `store.ts:1079` (`if (get().busy[id] === true) return;`). The rollback then runs the pre-patch object back through `replace` (`store.ts:1451`), which rebuilds `comments`, `threadsByFile` and the counters from it.

The sequence that loses a reply: the reader sends a reply on a thread, so `before` holds replies `[r_1]`; while the POST is in flight an agent answers on the same thread, the watcher emits `reply-added`, and `patchThread` stores the server's version with `[r_1, r_2]`; the POST then fails — the server restarted, the comment was dropped by a scope edit, or the network blinked — and the catch writes `[r_1]` back. `r_2` leaves the rail and the counters, including `awaiting`, which is the state the reader is watching for. The toast talks about the reader's own failed reply, so nothing on screen says a reply vanished.

Two things narrow this, and the entry is written to the narrowed version. The success path is clean: `answered` is the server's read taken after its own write, so it carries `r_2`. And nothing is lost on disk — the reply is in the data directory and comes back on the next reload, session switch, or any later frame that names the thread. What is wrong is the screen, for as long as the reader stays on it. Both conditions have to coincide — a live patch on this thread inside the window of a write that then fails — which is why this is minor rather than more.

[docs/reference/08-ui.md](../../reference/08-ui.md), lines 743–746, states the rule the code is trying to follow: "a refusal puts the thread back as it was", and "what is rolled back is that one comment and not the whole list". "As it was" is the sentence that needs a subject — as it was before the reader's own optimistic edit, not before everything that happened since.

## Work to do

- Decide what the rollback restores, and write the decision into `08-ui.md` next to the sentence above. The candidates: re-read the thread from the server on failure (correct by construction, costs a request on a path that just failed); undo only the optimistic delta rather than the whole object (`replace` with the current thread minus the draft reply, or with the previous status), which stays local but needs each caller of `write` to describe its own inverse; or let `patchThread` mark the thread as touched during the flight and skip the rollback when it is, which is the smallest change and leaves the optimistic reply on screen until something else replaces it.
- Whichever is chosen, `write`'s signature is where it lands: it already takes `optimistic`, so an inverse or a "patched while in flight" flag belongs beside it rather than in `sendReply` and `setStatus` separately.
- Say in the same pass whether `patchThread` should respect `busy` at all. It deliberately does not today — a live frame is the server's truth and the store should take it — and that is defensible; if it stays that way, the comment there should say so, because the two entry guards next to it read like an omission.

## Out of scope

- The optimistic write itself and the `r_pending` draft (`store.ts:1035–1041`). The card changing before the server answers is the design, not the defect.
- `busy` being per thread rather than one flag — that is deliberate and documented.
- The toast text on a refusal. A better message would not put the reply back.

## Verification

- A test in `tests/ui-threads.test.ts` drives the sequence directly: seed a thread, start `sendReply` against a fetch that does not resolve yet, call `patchThread` with a server copy carrying the agent's reply, then let the fetch reject. The thread afterwards still holds the agent's reply and no longer holds the pending draft, and the `awaiting` counter matches. Reverting the fix turns that test red on the missing reply, not on the toast.
- `tests/ui-live.test.ts` still passes — it already exercises `patchThread` for both a new reply and a status change (lines 458 and 467), and neither may change meaning.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`.
