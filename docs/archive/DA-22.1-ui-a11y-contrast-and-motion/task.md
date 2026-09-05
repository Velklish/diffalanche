# DA-22.1 · Small text on --tx3 is under WCAG AA, and no motion has a reduced-motion alternative

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** none
- **Taken:** 2026-09-05

## Context

Two findings of the Impeccable audit on the review workspace, from DA-22 and
widened by DA-23 and DA-24. Both are in the shipped token system rather than in either
task's own components, so neither was fixed there: changing a value in
`src/ui/tokens.css` changes `DESIGN.md` and disagrees with the token table of
`docs/design/HANDOFF.md`, which is a decision and not a fix in passing.

**Contrast.** `--tx3` is the colour of every small label on `--panel2` and
`--panel3`: the status bar hints, the hunk header, the repository base line, the
sidebar footer, the composer's anchor and its two captions; since DA-23,
`.thread-meta` (the author and time of a thread), `.reply-meta` (the role and
time of a reply), `.thread-anchor` and `.rail-empty`; and since DA-24,
`.picker-about` (what each base mode means), `.picker-note` and
`.picker-note-inline` (why a branch list is empty, and how many repositories
have a branch), `.menu-hint` (the base grammar under the create form),
`.export-meta` (the base and the count of the export) and `.context` (the whole
right-hand side of the status bar). The pairing measures
4.36:1 in the dark theme (`#828a95` on `#22262c`) and 4.24:1 in the light one
(`#736f66` on `#efece5`), both under the 4.5:1 WCAG AA asks of text below
18.66 px; every one of those labels is 10.5–11.5 px. `--tx2` on the same ground
is 5.97 and 6.40, so the fix may be as small as darkening `--tx3` by one step.
The severity chips are clear: `--onAcc` on the four severity colours is 5.38 at
worst.

A second contrast question came with DA-23: `.thread.resolved` is
`opacity: .55`, which multiplies the contrast of everything on a closed card —
its body at `--tx` on `--panel3` falls from 10.9:1 to about 4.4:1. The card is
still a control, so it is text a reader has to be able to read.

**Motion.** `tokens.css` declares `dcin` and `dcpulse` and nothing in the UI
declares a `prefers-reduced-motion` alternative. `dcpulse` is the one that
matters — it runs for as long as the review is open, on the sidebar footer's
watching dot and the activity panel's; `dcin` is a 140–160 ms entrance on the
overlay, the toast, the composer, the session menu, the file card's own
composer, and, since DA-23, every thread card the rail shows. A reader who has
asked their system for less motion gets all of it.

Evidence, from the repository at DA-24:

```
$ grep -c "animation:" src/ui/styles.css
6
$ grep -rn "prefers-reduced-motion" src/ui
(nothing)
$ grep -c "var(--tx3)" src/ui/styles.css
28
```

The contrast numbers are the WCAG relative-luminance formula over the token
pairs `tokens.css` declares; both themes are in the table above.

## Work to do

- Decide the contrast fix with the handoff: darken `--tx3` in both themes until
  small text on `--panel2` and `--panel` clears 4.5:1, or raise the labels that
  carry it to a size AA judges at 3:1. `src/ui/tokens.css`, `DESIGN.md`, and the
  token table of `docs/design/HANDOFF.md` change in one pass; the guard in
  `tests/design-tokens.test.ts` holds the first two together.
- Add a `prefers-reduced-motion: reduce` block: `dcpulse` stops on the live dots
  and leaves them lit, `dcin` keeps the opacity and drops the translate.
- Decide what a resolved thread looks like without `opacity: .55` — a border and
  a `--tx2` body would say the same and keep the text readable.
- Record both in `.impeccable/design.json`, which is where the motion and the
  focus rings live ([08-ui.md](../../reference/08-ui.md)).

## Out of scope

- The keyboard walk of the whole surface, which DA-26 owns
  (`.impeccable/surfaces/src-ui-app-tsx.md`, "Unresolved on this surface").

## Verification

- The contrast of every token pair the interface actually uses for text is
  computed in a unit test beside `tests/design-tokens.test.ts` and is at least
  4.5:1 for text under 18.66 px.
- A Playwright test with `prefers-reduced-motion: reduce` finds no element whose
  computed `animation-name` is `dcpulse`.
