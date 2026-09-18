# DA-70 · The Escape ladder and the search shortcuts enumerate overlays by hand, so one esc wipes a draft and two traps can stack

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

[08-ui.md:228-235](../../reference/08-ui.md) states the invariant and, in the same paragraph, admits it is unenforced: "**One overlay is on screen at a time, and `Overlay` is written for that.** … Nothing enforces the rule; `App.tsx` keeps it by rendering the overlays of one surface exclusively". The keyboard breaks it in two directions, because both places that decide what a key means hold a written-out list of overlay flags rather than asking which surface is on top.

**The Escape ladder does not know about the scope surface.** [src/ui/keys.ts:60-79](../../../src/ui/keys.ts):

```ts
if (event.key === "Escape") {
  if (store.paletteOpen) { store.setPalette(false); return; }
  if (store.sessionMenuOpen || store.baseOpen || store.exportOpen) { … return; }
  if (store.replyId !== null) { store.openReply(null); return; }
  store.closeComposer();
  return;
}
```

`scopeOpen`, `scopeConfirm` and `newTaskOpen` are not in it, and `closeComposer` (store.ts:954-955) sets `body: ""` — the typed draft. `openScope` (store.ts:773-783) sets three keys and never touches `composer`, so an open composer and an open scope overlay coexist. The overlay closes itself, from its own document listener at [Overlay.tsx:36-42](../../../src/ui/components/Overlay.tsx), and the same keydown reaches keys.ts, falls past every branch and throws the comment away. Nothing calls `stopPropagation` and no listener checks `defaultPrevented`.

Reachability differs by overlay, which narrows the finder's version. The `SCOPE` pill returns `null` for a session without a scope ([Header.tsx:160-172](../../../src/ui/components/Header.tsx) — `if (scope === null) return null;`), so that route needs a scoped task; `New task…` does not — it is an ordinary sidebar button ([Sidebar.tsx:121](../../../src/ui/components/Sidebar.tsx)), and `newTaskOpen` is equally absent from the ladder. The confirmation, `scopeConfirm`, *replaces* the editor rather than stacking on it (App.tsx:167-173), which is why `e2e/scope.spec.ts:209` passes: it presses `Escape` with no composer open.

**`⌘K` and `⇧⇧` open global search on top of whatever is already open.** keys.ts:81-86 handles `⌘K` and returns before the guard that would stop it, which is twelve lines further down at keys.ts:98 and covers plain letters only. The Shift branch refuses `inField && !store.paletteOpen` (keys.ts:48), and with an overlay open the focus is the panel `div` (Overlay.tsx:68, `tabIndex={-1}`, focused at Overlay.tsx:103-105), so `inField` is false and `⇧⇧` passes as well. `setPalette` (store.ts:1100) closes nothing else, and App.tsx:164-176 renders `{baseOpen ? <BasePicker/>}`, `{exportOpen ? <ExportModal/>}` and `<GlobalSearch/>` as independent siblings. Two `Overlay`s are then mounted, each with its own document `Tab` handler (Overlay.tsx:107-137) calling `preventDefault()` and refocusing its own panel, and one `esc` reaches both listeners plus the ladder. The exclusivity `App.tsx` keeps by hand holds *within* the scope surface only, not across base, export and search.

**A third symptom of the same list, checked while reading it:** keys.ts:98 — `if (store.paletteOpen || store.baseOpen || store.exportOpen) return;` — also omits `scopeOpen`. The scope editor has no autofocused field (the `autoFocus` at ScopeEditor.tsx:202 belongs to the new-task form below it), so the panel holds the focus, `inField` is false, and `c`, `j`, `k`, `r` under the open editor reach the diff behind it: `c` opens the composer on the current file (keys.ts:101-107). Whatever closes the other two symptoms should close this one, since it is the same enumeration read twice.

## Work to do

- Decide how the topmost surface is known, and write it once. Candidates: a derived selector over the store — an ordered list of overlay flags with the top one named — that both the Escape ladder and the letter guard consult; or a small overlay stack held by `Overlay` itself, where only the top instance answers `esc` and `Tab` and the ladder asks whether any is open. The first is a smaller change and keeps the flags where they are; the second is what 08-ui.md means by "teaches `Overlay` to stack", and it is the one that survives the next overlay being added.
- Whichever is chosen, adding an overlay must not require editing keys.ts. That is the defect: three flags exist that two hand-written lists do not mention.
- Make one `esc` close exactly one thing. The composer's draft is the value at risk, so the ladder must not reach `closeComposer()` on a press that an overlay has already answered.
- Decide whether `⌘K` and `⇧⇧` over an open overlay should be refused or should replace what is open. Refusing is consistent with "one at a time"; replacing is what a reader pressing `⌘K` probably means. Either is defensible, and the choice belongs in 08-ui.md beside the invariant it enforces.
- Update 08-ui.md:228-235 so the paragraph no longer says the rule is kept by convention, once it is not.

## Out of scope

- Changing how `Overlay` restores the focus to its opener, beyond what the chosen design requires.
- The sessions menu, which is a popover rather than a modal and is already in the ladder.
- The scope confirmation replacing the editor (App.tsx:167-173). That arrangement is deliberate and documented; it is the reason `scopeConfirm` is not a second trap.

## Verification

- With a comment typed into the composer and the scope editor open, `esc` closes the editor and leaves the draft. Same with `New task…`. Removing the guard turns both red.
- `⌘K` and `⇧⇧` with the base picker open leave exactly one overlay mounted, and a single `esc` afterwards leaves the other one on screen or closes nothing, per the decision above. Asserting the count of mounted overlays is what makes a regression visible.
- Under the open scope editor, `c` does not open the composer and `j`/`k` do not move the diff selection.
- These are e2e cases: `e2e/keyboard.spec.ts` already exercises the palette alone (lines 140-160) and `⌘K` over the composer (line 205); the new cases are the combinations neither file covers.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, plus `bun run test:ui` for the new keyboard cases.
