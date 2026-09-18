# DA-105 · Toast lifetime is keyed on the message text, so repeating a message does not restart the timer

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

[08-ui.md](../../reference/08-ui.md) says `components/Toast.tsx` shows the
store's `toast` for 2.2 seconds. It shows it for 2.2 seconds counted from the
*first* time that exact string was set, not from the last.

[src/ui/components/Toast.tsx:7-15](../../../src/ui/components/Toast.tsx):

```tsx
export function Toast() {
  const toast = useStore((store) => store.toast);
  const setToast = useStore((store) => store.setToast);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toast, setToast]);
```

The effect's dependency is the message itself, and the message is a bare
string — [src/ui/store.ts:409-410](../../../src/ui/store.ts) declares
`toast: string | null` with `setToast: (toast: string | null) => void`, and
line 1099 implements it as `setToast: (toast) => set({ toast })`. There is no
id, sequence number or timestamp beside it. Writing the same string again does
notify zustand's subscribers, but the subscription here is
`useStore((store) => store.toast)`, and the selected slice is compared with
`Object.is`: two identical strings are equal, so the component does not
re-render, the effect does not re-run, and the original deadline stands.

The repeat is not hypothetical.
[src/ui/keys.ts:128](../../../src/ui/keys.ts) raises one fixed constant on every
press of `B` — `store.setToast("Обход репозитория — Phase 2 (DA-37)")`.
Press `B` at t=0 and again at t=2.0 s: the second press produces no new timer,
and at t=2.2 s the first one clears the toast, so the answer to the second press
is on screen for 200 ms. The same holds for every failure path that formats its
text from `reason(error)` — `src/ui/store.ts` raises a toast from seventeen
places directly with `set({ toast: … })` (lines 619, 621, 698, 701, 711, 745,
747, 802, 832, 835, 993, 996, 1115, 1117, 1172, 1393, 1445) besides the three
callers of `setToast` in `keys.ts` and `live.ts` — and the same error against the
same endpoint produces the same sentence twice.

The effect is cosmetic: nothing is lost, no state is wrong, the toast is only
shorter than it should be. It is filed because the shortened toast happens
exactly when the user is repeating an action because they did not see the answer
the first time.

## Work to do

- Decide what identifies a toast. The candidates: keep `toast` a string and add
  a monotonic counter beside it that the effect depends on; make the store hold
  an object (`{ text, seq }` or `{ text, at }`) and have the component subscribe
  to the whole of it; or keep the state as it is and reset the timer inside the
  setter rather than in an effect. The third moves timer ownership out of the
  component, which is a different shape from every other overlay in
  `src/ui`, so it is a decision and not an implementation detail.
- Whichever is chosen, make it cover the seventeen raise sites that call
  `set({ toast: … })` directly and do not go through `setToast`. A fix applied
  only inside `setToast` leaves most of the toasts in the application on the old
  behaviour, which is worse than the current uniform bug.
- Keep `toast: null` meaning "nothing on screen" — `Toast.tsx:17` returns
  `null` on it and `e2e/keyboard.spec.ts:195` asserts the element is hidden, so
  the empty state must stay expressible.
- Update [08-ui.md](../../reference/08-ui.md) where it describes the toast's
  2.2 seconds, so the sentence says from when the 2.2 seconds are counted.

## Out of scope

- Queueing or stacking toasts. One at a time is the current design and this
  entry does not reopen it; the change is when the single toast expires.
- The wording of any message, and the `B` placeholder itself, which goes away
  with DA-37.
- Any other zustand selector that compares equal on a repeated write. If the
  same shape exists elsewhere in the store it is a separate finding and gets its
  own file.

## Verification

- A test that presses the trigger twice with a gap shorter than the lifetime and
  asserts the toast is still on screen after the first deadline would have
  passed. The natural home is `e2e/keyboard.spec.ts`, beside the existing `B`
  case at lines 163-167, since `tests/` exercises the store and never renders a
  component.
- The mutation probe: revert the store change and leave the test — it must go
  red. A test that stays green with the old keying is testing nothing.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`,
  plus `bun run test:ui` for the e2e case. `bun run perf` is unaffected.
