# DA-107 · The review does not fit the screen: the side panels cannot be hidden and a long line never wraps

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-18
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

From the owner's real reviews, 2026-09-18: reading a change set means scrolling
sideways all the time. Two decisions of the design produce that together.

The panels are fixed. `.app` carries `min-width: 1560px`
([src/ui/styles.css:39](../../../src/ui/styles.css)); the sidebar is 308 px and
the rail 392 px ([src/ui/styles.css:272](../../../src/ui/styles.css),
[:278](../../../src/ui/styles.css)), and neither has a way off the screen.
`DESIGN.md` names it *The Panels-Do-Not-Shrink Rule* — "nothing compresses,
nothing collapses, nothing becomes a drawer" — and the handoff's section 1 says
the same in its layout line. On a window narrower than 1560 px the whole page
scrolls sideways, and on any window the two panels take 700 px that the reading
column needs.

A long line never wraps. The diff's code cell is `white-space: pre`
([src/ui/styles.css:1186](../../../src/ui/styles.css)), and the table is given
a width of `max(1080px, …)` from the widest line of the file
([src/ui/styles.css:1157](../../../src/ui/styles.css)), so every file card owns
a horizontal scroll and a line of 200 characters is read by dragging it. The
height a card claims before its diff is mounted is arithmetic over the patch on
a fixed 22 px row ([src/ui/measure.ts:11](../../../src/ui/measure.ts)), which
is why the rows are fixed today ([ADR-008](../../adr/adr-008-diff-rendering-verdict.md)).

Both decisions were taken for a wide desktop and are reversed here by the
owner's decision. `AGENTS.md` makes `DESIGN.md` and the handoff the source of
layout and visual rules, so they change in the same pass as the code: a rule
that the code no longer follows is a rule the next task will restore.

## Work to do

- **Each side panel hides and comes back.** The sidebar and the rail each get a
  control that takes the panel off the screen entirely — not a narrower
  version, not a drawer — and a way back when it is hidden (a text symbol in the
  panel's own top row, and a stub or header control once the panel is gone; the
  design language is text symbols, not icons). Keys: `[` for the sidebar and `]`
  for the rail, silent in `input` and `textarea` like the rest of the map, and
  added to the status bar's hints. The preference is the reader's, not the
  task's: it lives in `localStorage` the way the theme does
  ([src/ui/store.ts:123](../../../src/ui/store.ts)) and survives a reload and a
  switch of task.
- **The floor follows the panels.** `.app`'s minimum width is 1560 px with both
  panels, and 308 or 392 less for each one hidden, so a window narrower than
  1560 px stops scrolling sideways once the panels it cannot fit are gone. The
  centre column takes the freed width.
- **A long line wraps, by default.** A line longer than its code column wraps
  inside that column — the columns of a split view keep their halves, the gutter
  keeps its 42 px, and a file card no longer owns a horizontal scroll: the diff
  is as wide as the card. A `wrap` / `scroll` control in the header, in the same
  form as the theme toggle and persisted the same way, brings the old behaviour
  back for a reader who wants the columns aligned character by character.
- **The pre-mount height stays honest.** `measurePatch` counts fixed rows; with
  wrapping on, a row is 22 px times the number of visual lines, and the count
  depends on the column's width in characters. Either the estimate takes that
  width and counts wrapped rows, or the card corrects its claim as soon as it is
  mounted — whichever keeps the scrollbar from drifting while unseen files are
  scrolled past, which is what ADR-008 protects. Say in `result.md` which one and
  why.
- **Documents in the same pass.** `DESIGN.md`: the principles line, the layout
  paragraph, *The Panels-Do-Not-Shrink Rule* and the *Do* item about fixed
  widths are rewritten to what the product now does. `docs/design/HANDOFF.md`:
  the layout line of section 1, the sidebar, the rail and the diff-lines items,
  and the keyboard map. `docs/reference/08-ui.md`: the page, the diff, the header
  and the keyboard map sections. `CHANGELOG.md`. The Impeccable context loader
  runs first, as `AGENTS.md` requires for anything under `src/ui`, and its
  `audit` and `polish` run on the touched surface before the result.

## Out of scope

- A responsive or phone layout: hiding a panel is a reader's choice, not a
  breakpoint, and the tool stays a desktop tool.
- Dragging a panel to another width.
- Wrapping anywhere but the diff: thread cards already wrap, and the sidebar's
  tree rows keep their ellipsis.

## Verification

- `e2e/shell.spec.ts` (or a new spec beside it): `[` hides the sidebar and the
  centre column grows by 308 px; `]` does the same for the rail with 392; a
  reload keeps both hidden; at a 1200 px window with both hidden
  `document.documentElement.scrollWidth` equals its `clientWidth`. The existing
  test "the panels keep their widths, and the page scrolls below the threshold"
  is rewritten to say what is true now: with both panels shown, the floor is
  still 1560.
- `e2e/diff.spec.ts` (or beside it): a file with a 300-character line at a
  1200 px window — with wrap on, the diff's `scrollWidth` equals its
  `clientWidth` and that row is taller than 22 px; with wrap off, the card has
  a horizontal scroll and the row is 22 px.
- `tests/diff-height.test.ts`: the pre-mount estimate of a patch with a long
  line, at a given column width, matches the number of wrapped rows — or, if the
  card corrects itself after mount, a test that the correction lands before the
  next frame.
- `bun run perf` is green with wrap on, which is the default the gate measures;
  the numbers go into `result.md` beside the baseline of `main` before this task.
- `grep -n "Panels-Do-Not-Shrink" DESIGN.md` finds a rule that describes hidden
  panels, not fixed ones; `bun run test` keeps `tests/design-tokens.test.ts`
  green.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.
