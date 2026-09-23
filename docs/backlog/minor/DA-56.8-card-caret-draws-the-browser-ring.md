# DA-56.8 · The file card's caret draws the browser's own focus ring, not the system's

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Parent:** DA-56.7
- **Cost:** minor

## Evidence

Found by the keyboard walk DA-56.7's polish pass made in both themes on the
synthetic fixture (Chromium through Playwright, 40 `Tab` stops from the top of the
page, computed `outline` and `border-top-color` read at each stop). Every stop
drew the system's ring — `acc` as a border on the pills, the counters, the ghost
buttons and the filter, `acc` as a 1 px outline on the segments, the tabs, the
tree rows and the panel toggle — except stop 39, the collapse caret of the first
file card (`button.caret` in `.file-head`):

```
dark   39 button.caret|collapse | outline auto rgb(153, 200, 255) 0px
light  39 button.caret|collapse | outline auto rgb(0, 95, 204) 0px
```

`outline: auto` in a blue that is not in `tokens.css` is Chromium's own focus
ring: `.file-head .caret` in `src/ui/styles.css` resets `border` and `background`
and sets no `:focus-visible` rule, so nothing replaces the default.

It is visible, so this is not a missing indicator — it is a control outside the
rule `DESIGN.md` states ("Focus is always visible and always `acc`"), and the
next caret added will copy it. The walk stopped at 40 stops per theme, inside the
first file card; controls further down the page — the hunk buttons, the rail, the
overlays — were not walked, so there may be more of these.
