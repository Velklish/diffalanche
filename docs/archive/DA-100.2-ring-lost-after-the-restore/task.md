# DA-100.2 · The ring is restored to the opener and then lost to `<body>` when the action the overlay was for lands

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Dependencies:** none
- **Parent:** DA-100.1
- **Cost:** major

## Context

Found while reproducing the candidate path of DA-100.1 in a browser, which that
card required before its fallback was decided. The path is real — the ring does
end on `<body>` after a task is created from select mode — but not for the reason
the card traced. The restore is **not** the step that fails: it runs, puts the
ring on the opener, and the opener loses it a moment later, when the review the
overlay asked for arrives and takes the opener away. The fallback DA-100.1 added
acts at the moment of the restore, so it never sees this.

**How it was measured.** Chromium through Playwright, `e2e/playwright.config.ts`
against the small synthetic fixture, on the tree of DA-100.1 before its change
(base `5a5f8e8`). A throwaway spec installed capturing `focusin` / `focusout`
listeners on `document`, a `MutationObserver` on `disabled`, and a wrapper around
`fetch`, each logging milliseconds from the moment before the press; the spec was
deleted afterwards. Times are from one run each on a loaded machine and say only
what came before what.

**Select mode, `New task…` → `Create`** (the whole root, one repository ticked):

| ms | event |
|---:|---|
| 516 | `POST /api/sessions` sent |
| 746 | `POST /api/sessions` answered 201 — `createSession` sets `newTaskOpen: false` |
| 749 | `GET /api/review?review=<name>` sent (`showTask`) |
| 752 | `focusin` on `button.primary.small` "New task…", `disabled=false` — **the restore worked** |
| 1605 | `GET /api/review` answered 200 — `fromDocument` takes the `switched` branch, `selectDraft: {}` |
| 1612 | `disabled` set on "New task…" (`disabled={empty}` in `SelectBar`) |
| 1628 | `focusout` on "New task…" — the browser's focus fixup; nothing takes it |

`document.activeElement` afterwards: `body`. The next `Tab` lands on
"Comment on repo", the first control of the page's content.

**The no-changes screen, `Change base` → `Apply`** (`/api/review` stubbed to an
empty change set, then to the fixture's review once `PUT …/base` was answered):

| ms | event |
|---:|---|
| 500 | `focusin` on the picker's `Apply` |
| 550 | `focusin` on `button.ghost.accent` "Change base" — **the restore worked** |
| 618 | `focusout` on "Change base" as `NoChanges` unmounts under the review that arrived |

`document.activeElement` afterwards: `body`.

Both actions close their overlay before they read the review, and both hold
`switching` across that read:

<!-- quote:../../../src/ui/store.ts -->
```ts
      if (!response.ok) throw new Error((await refusal(response)).message);
      set({ baseOpen: false });
      get().markSelf("review", session.name);
```
<!-- /quote -->

<!-- quote:../../../src/ui/store.ts -->
```ts
      if (!response.ok) throw new Error((await refusal(response)).message);
      set({ sessionMenuOpen: false, scopeOpen: false, newTaskOpen: false, newName: "" });
```
<!-- /quote -->

`applyBase` sets `switching: true` before its `PUT` and `false` after
`loadReview()`; `createSession` does the same around its `POST` and `showTask()`.
So the restore, scheduled one macrotask after the unmount, always runs before
the server has answered the read.

## Work to do

- Choose where the fix lives and write the reason into
  [08-ui.md](../../reference/08-ui.md) beside the promise. Two candidates:
  - **Defer the restore until `switching` is false.** Both live paths hold it
    across the read, so the restore would then see the opener already disabled or
    gone and hand the ring to the ladder's header control (DA-100.1's fallback) —
    the new task's `SCOPE` pill, the `BASE` pill. The cost: `Overlay` is the
    primitive of every overlay, and a subscription to one flag of the store ties
    it to that one state; an action that closes an overlay and then loads
    without `switching` would slip past.
  - **Guard the ring after the restore**: keep watching the restored control for
    a short while and, if it loses the ring to nowhere, apply the same fallback.
    Independent of the store, but a timer whose length is a guess.
- Playwright cases on **both live paths** above — not a synthetically removed
  opener — asserting where the ring is, and that it is not `<body>`.

## Out of scope

- The fallback itself and the check that the opener took the ring, which
  DA-100.1 settled.
- When `createSession` clears `selectDraft`, and when `applyBase` closes the
  picker: those are the actions' own order and DA-100.1 already put them out of
  scope.

## Verification

- The two traces above, re-run after the fix, end on a named control and not on
  `<body>`, each pinned by a Playwright case.
- A mutation probe on the chosen mechanism turns those cases red.
- Gates: `npx github:Velklish/backslop#v0.9.0 gates` green by count.
