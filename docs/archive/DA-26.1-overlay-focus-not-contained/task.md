# DA-26.1 · Tab leaves an open overlay and walks the page behind it

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-22, DA-24, DA-26

## Context

Found by the keyboard walk of DA-26, which the surface brief made that task's
(`.impeccable/surfaces/src-ui-app-tsx.md`, "Unresolved on this surface"). Every
control the walk touched has a visible `accBd` focus treatment, and every key of
the handoff's map does what the table says. What the walk does not fix is where
the focus may go while something is open over the scrim.

`components/Overlay.tsx` and the modals built on the same shape — global search,
the base picker, the sessions menu, the export — put a scrim over the page and
close on `esc` and on a click, but none of them holds the tab ring. `Tab` from
the last row of a search result list moves into the header behind the scrim, and
from there through the whole review: the reader is typing into a page they
cannot see. `Shift+Tab` from the field does the same in the other direction, and
nothing returns the focus to what opened the modal when it closes.

It is one treatment for every overlay and belongs to the primitive rather than
to any one of them, which is why it is filed rather than fixed inside DA-26:
global search would get a ring the base picker and the export still lack, and
three modals behaving differently under `Tab` is worse than three behaving the
same way badly.

## Work to do

- Contain the focus in `components/Overlay.tsx` and in the two modals that build
  their own scrim (`components/GlobalSearch.tsx`, and the picker of DA-24 if it
  does not use the primitive): `Tab` and `Shift+Tab` cycle inside the panel.
- Give the focus back to the control that opened the overlay when it closes,
  including when `esc` closes it.
- Say in [08-ui.md](../../reference/08-ui.md), beside what the overlay primitive
  already carries, that an overlay holds the focus while it is open.

## Out of scope

- The focus treatment itself — the border change on bordered controls and the
  1 px outline on rows that have none — which `DESIGN.md` records and the walk
  found consistent.
- Contrast and reduced motion, which are DA-22.1.

## Verification

- A Playwright check: with global search open, `Tab` pressed as many times as
  the modal has focusable controls plus one leaves the focus inside the modal,
  and `esc` puts it back on the header's search button.
