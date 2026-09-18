# DA-100 · Overlay captures its opener during render, so a swap between overlays restores focus to a node that is gone

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

`Overlay` promises in its own doc comment, and [08-ui.md](../../reference/08-ui.md) lines 221-222 repeat, that "when the overlay closes, by `esc`, by the scrim, or by finishing what it was for, the focus goes back to the control that opened it". It keeps that promise for a single overlay and breaks it across the scope editor's confirmation round-trip.

The opener is read while the component renders, and the restore is guarded on the node still being in the document — [src/ui/components/Overlay.tsx](../../../src/ui/components/Overlay.tsx), lines 33-34 and 142-143:

```tsx
  const opener = useRef<Element | null>(null);
  opener.current ??= document.activeElement;
...
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
```

The render-time read is deliberate and the comment above it says why: a child that focuses itself as it mounts would otherwise be the "opener". The defect is not that read on its own. It is that the scope editor and its confirmation occupy the same position in the tree — [src/ui/App.tsx](../../../src/ui/App.tsx), lines 167-172:

```tsx
      {confirm !== null ? (
        <ScopeConfirmation confirm={confirm} />
      ) : scopeOpen ? (
        <ScopeEditor />
      ) : newTaskOpen ? (
```

Both render an `Overlay` ([src/ui/components/ScopeEditor.tsx](../../../src/ui/components/ScopeEditor.tsx), lines 29 and 146), and `scopeOpen` stays true underneath the confirmation: `applyScope` sets only `{ applying: false, scopeConfirm: asQuestion(...) }` on the server's 409 ([src/ui/store.ts:818](../../../src/ui/store.ts)), and `cancelScopeConfirm` sets only `{ scopeConfirm: null }` (line 789). Different component types at one position mean React deletes one subtree and mounts the other, so each swap gets a fresh `useRef(null)` and captures whatever is active at that instant.

Traced through the chain: the SCOPE pill ([src/ui/components/Header.tsx](../../../src/ui/components/Header.tsx), lines 164-169) opens the editor, which records the pill and would restore it correctly. `Apply` raises the 409, and the confirmation captures whatever is active then — `<body>`, because `Apply` is `disabled={applying || counted.repos === 0}` (ScopeEditor.tsx:62) and a disabled button blurs, or the `Apply` node itself. `Отмена` (ScopeEditor.tsx:154) brings the editor back, and the editor's new `Overlay` records the `Отмена` button. `esc` then closes the editor, and by that point the `Отмена` button has been detached for two commits: `back.isConnected` is false, the branch at line 143 does nothing at all, and the reader is left with the ring on `<body>` — the next `Tab` starts from the top of the page.

Two narrowings against the way this was first written. The plain path is correct: open one overlay, close it, and the focus goes back. Only the editor → confirmation → editor round-trip is affected. And the end state above is traced from the code, not observed in a browser — the chain of commits and the two guards are what the files say; "the ring ends on `<body>`" is the consequence that follows and is a hypothesis until a test runs it.

Nothing catches it. [e2e/scope.spec.ts](../../../e2e/scope.spec.ts), lines 206-231, walks exactly this round-trip — `Apply`, the 409, `esc`, `Apply` again, `Отмена` — but asserts counts, the surviving draft, and one `Tab` stop inside the confirmation (line 219). The suite's only focus-return assertion is [e2e/keyboard.spec.ts](../../../e2e/keyboard.spec.ts), lines 157-160, and it covers the single-overlay palette.

## Work to do

- Decide where the opener lives before changing `Overlay`, and record the decision. The candidates: the store owns one opener for a ladder of overlays, captured when the ladder opens and cleared when it fully closes; `Overlay` takes the restore target as a prop, so `ScopeConfirmation` can hand on what the editor recorded; or `Overlay` keeps capturing but falls back when `back.isConnected` is false — and then the fallback target has to be named, since "somewhere sensible" is what `<body>` already is.
- Whichever is chosen, make the silent no-op at Overlay.tsx:143 impossible to reach unnoticed: a detached opener today is indistinguishable from a successful restore.
- Check the other overlays that can swap at the same position — `NewTaskForm` sits in the same chain in App.tsx, and the base picker, the export and global search are separate — and say in [08-ui.md](../../reference/08-ui.md) which of them form one ladder for focus purposes.
- Update the promise in [08-ui.md](../../reference/08-ui.md) and the `Overlay` doc comment together if the answer changes what "the control that opened it" means for a chained overlay.

## Out of scope

- The `esc` ladder and the search shortcuts enumerating overlays by hand, filed as [DA-70](../../archive/DA-70-overlay-ladder-is-hand-enumerated/task.md). It is about the same set of overlays and a fix may well share a notion of "the ladder" with this one, but the failure there is a wiped draft and two stacked traps, not the focus return.
- The focus trap itself — `Tab` and `Shift+Tab` cycling inside the panel — which works and which `e2e/scope.spec.ts` line 219 already asserts for the confirmation.
- Whether `scopeOpen` should stay true under the confirmation. It is what gives the editor back with its draft intact when the question is cancelled, and this entry does not propose changing it.

## Verification

- An e2e case extends the round-trip in `e2e/scope.spec.ts`: SCOPE pill → `Apply` → confirmation → `Отмена` → `esc`, then asserts the SCOPE pill is focused. It fails on the current code, which is the reproduction this entry owes.
- Removing the fix turns that assertion red; the existing single-overlay assertion in `e2e/keyboard.spec.ts` stays green either way, which is what shows the change did not buy the chain at the cost of the simple case.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`.
