# DA-94 · A thread is rendered twice, so Reply mounts two auto-focusing textareas

- **Order:** 490
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

One thread is on screen twice on purpose: as the widget under the line it is anchored to, and as a card in the rail. [docs/reference/08-ui.md](../../reference/08-ui.md), line 690, says so — "drawn the same in both places it appears" — and both components repeat it in their own comments (`ThreadCard.tsx:13`, `ThreadRail.tsx:13`). What is not deliberate is that the reply field is drawn twice with it, and that both copies grab the caret.

Both instances subscribe to the same flag and both render the field from it:

[src/ui/components/ThreadCard.tsx](../../../src/ui/components/ThreadCard.tsx), lines 30 and 88

```tsx
  const replying = useStore((store) => store.replyId === thread.id);
…
      {replying ? <ReplyField id={thread.id} busy={busy} /> : null}
```

and the field focuses itself as it attaches:

[src/ui/components/ThreadCard.tsx](../../../src/ui/components/ThreadCard.tsx), lines 152 and 164

```tsx
  const focusHere = useCallback((element: HTMLTextAreaElement | null) => element?.focus(), []);
…
        ref={focusHere}
```

The store holds only the id — `openReply: (replyId) => set({ replyId, replyText: "" })` at `store.ts:1027` — so nothing distinguishes the copy the reviewer pressed from the other one. The two parents are `InlineThread` (`src/ui/components/FileCard.tsx:295–305`, `scope="file"`) and the rail's list (`src/ui/components/ThreadRail.tsx:81`), and the rail's default scope is the current file (`store.ts:1004` `railScope: "file"`, filtered at `ThreadRail.tsx:26–28` on `comment.repo === repo && comment.path === path`) — the very file whose widgets are mounted. Nothing hides either copy: the only `.thread-widget` rules in `src/ui/styles.css` are `contain: layout paint style` at line 1860 and the margins around it.

The corrected shape of the failure, which is what to fix against: two `ReplyField`s mount for one thread whenever the rail is on the file that owns the anchored widget; callback refs fire in tree order and `<ThreadRail />` comes after `<CentrePanel />` in `src/ui/App.tsx:135–137`, so the rail's textarea calls `focus()` last and wins. Press `Reply` on the widget under the line and the caret — with the scroll that `focus()` brings — lands in the right rail instead, while the field under the line looks open and inert. A screen reader finds two controls labelled `reply` for one thread, the label being on both the form and the textarea (`ThreadCard.tsx:157` and `:167`).

No text is lost: both textareas read and write the same `store.replyText` (`ThreadCard.tsx:146`), so whichever one is typed into, the other shows the same characters and `sendReply` sends them. That is why this is minor — a caret jolt, an unwanted scroll, and duplicate labels, not a lost reply.

There is already a mark left by this in the suite: `e2e/threads.spec.ts:159` has to scope its locator to `.rail-list [data-thread="…"]` to reach one of the two, which is a workaround rather than a test of the behaviour.

## Work to do

- Decide which copy owns the open reply, and record it in `08-ui.md` next to the passage above, because it is the first case where the two copies are not interchangeable. The candidates: keep the id in the store and add the place it was opened from (`replyId` plus a scope, so only the matching card renders the field); render the field only in the widget when one exists and only in the rail otherwise; or keep both fields and give only one the focusing ref.
- Whichever is chosen, the field must stay where the reviewer pressed `Reply`. The reference's own rule for the composer, at line 675, is that the field is where the reviewer already is; a fix that focuses the widget unconditionally breaks the rail's own `Reply` in the other direction.
- Make sure a thread with no widget — anchored to a line a collapsed hunk hides, or with `line === null`, both filtered out at `FileCard.tsx:239–241` — still opens its field in the rail. That is the case a naive "widget wins" rule drops.
- Leave one control labelled `reply` per open thread once a single field renders; if both are kept, the hidden one is what needs the `aria-hidden` and the removed label.

## Out of scope

- The double rendering of the card itself. Two copies of the thread are the design, and this entry does not question them.
- The duplicated `aria-label="reply"` on the form and the textarea of one field. That is a separate labelling question and does not change which element takes the caret.
- `revealThread` and the focus dance between rail and widget (`08-ui.md`, lines 715–721), which is about `focusId`, not about `replyId`.

## Verification

- The check belongs in Playwright, not in `tests/`: there is no DOM harness under vitest — `vitest.config.ts` sets no environment and `tests/ui-threads.test.ts` imports the store and nothing else, so it can assert `replyId` but never how many textareas that produces. A new case in `e2e/threads.spec.ts`, on a thread that has a widget (the file it anchors to is already opened there at line 106), presses `Reply` on the widget and asserts `page.locator(".reply-field")` has the count the decision above settles on, and that the focused element is inside the widget. Reverting the fix turns it red on the count, which today is two.
- The locator at `e2e/threads.spec.ts:159` no longer needs `.rail-list` to be unambiguous — either it is dropped, or that test keeps it deliberately and says why. A commented-out scope prefix is not a fix.
- The Impeccable pass required by `AGENTS.md` for anything under `src/ui` runs on the thread surface, and every finding it does not fix is named in the result.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`.
