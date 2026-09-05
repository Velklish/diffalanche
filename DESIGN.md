---
name: diffalanche
description: Many repositories reviewed as one change set — a dark, instrument-dense workspace where the only loud thing on screen is a finding.
colors:
  bg: "#1d2025"
  panel: "#212429"
  panel2: "#22262c"
  panel3: "#282d34"
  bd: "#333941"
  bd2: "#2c313a"
  tx: "#dde1e7"
  tx2: "#9ba3ae"
  tx3: "#828a95"
  acc: "#8b9ae0"
  accBg: "#26293a"
  accBd: "#3f4a80"
  accTx: "#a8b3e6"
  add: "rgba(110, 190, 145, 0.15)"
  addTx: "#a9dcc0"
  del: "rgba(214, 110, 100, 0.15)"
  delTx: "#eeb4ad"
  crit: "#e0837a"
  warn: "#dfa85c"
  nit: "#7ec49c"
  q: "#8b9ae0"
  ok: "#5ba37c"
  onAcc: "#1c1f2b"
  sel: "#333c66"
  code: "#bcc2cb"
  ln: "#767e89"
  gap: "#22262c"
  scrim: "rgba(10, 11, 13, 0.5)"
  bg-light: "#f2f0eb"
  panel-light: "#fbfaf7"
  panel2-light: "#efece5"
  panel3-light: "#e7e3da"
  bd-light: "#d8d2c7"
  bd2-light: "#e6e1d8"
  tx-light: "#2e2d29"
  tx2-light: "#57544d"
  tx3-light: "#736f66"
  acc-light: "#4d5793"
  accBg-light: "#e6e9f5"
  accBd-light: "#aab2d8"
  accTx-light: "#3a4478"
  add-light: "rgba(58, 122, 84, 0.17)"
  addTx-light: "#26603c"
  del-light: "rgba(174, 70, 60, 0.15)"
  delTx-light: "#8a352d"
  crit-light: "#a94a41"
  warn-light: "#8a5f18"
  nit-light: "#376f4e"
  q-light: "#4d5793"
  ok-light: "#3f6b4f"
  onAcc-light: "#fbfaf7"
  sel-light: "#dbe0f2"
  code-light: "#403d38"
  ln-light: "#8a857a"
  gap-light: "#efece5"
  scrim-light: "rgba(70, 64, 54, 0.26)"
typography:
  display:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  title:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13.5px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  meta:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.07em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "22px"
    letterSpacing: "normal"
rounded:
  mark: "2.5px"
  chip: "4px"
  hunk: "5px"
  segment: "6px"
  row: "7px"
  control: "8px"
  card: "9px"
  panel: "10px"
  modal: "12px"
spacing:
  "4": "4px"
  "6": "6px"
  "7": "7px"
  "8": "8px"
  "9": "9px"
  "10": "10px"
  "11": "11px"
  "12": "12px"
  "14": "14px"
  "16": "16px"
  "18": "18px"
  "22": "22px"
components:
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.tx2}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  segment:
    backgroundColor: "transparent"
    textColor: "{colors.tx2}"
    width: "26px"
    height: "26px"
  segment-on:
    backgroundColor: "{colors.bd}"
    textColor: "{colors.tx}"
    width: "26px"
    height: "26px"
  pill:
    backgroundColor: "{colors.panel3}"
    textColor: "{colors.tx}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  input-filter:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.tx}"
    rounded: "{rounded.control}"
    padding: "0 38px 0 9px"
    height: "28px"
  key-chip:
    backgroundColor: "transparent"
    textColor: "{colors.tx3}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "1px 4px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.tx3}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "2px 6px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.tx2}"
    rounded: "{rounded.row}"
    padding: "4px 9px"
  tab-on:
    backgroundColor: "{colors.panel3}"
    textColor: "{colors.tx}"
    rounded: "{rounded.row}"
    padding: "4px 9px"
  badge-critical:
    backgroundColor: "{colors.crit}"
    textColor: "{colors.onAcc}"
    rounded: "{rounded.card}"
    padding: "1px 7px"
  badge-warning:
    backgroundColor: "{colors.warn}"
    textColor: "{colors.onAcc}"
    rounded: "{rounded.card}"
    padding: "1px 7px"
  badge-nit:
    backgroundColor: "{colors.nit}"
    textColor: "{colors.onAcc}"
    rounded: "{rounded.card}"
    padding: "1px 7px"
  badge-question:
    backgroundColor: "{colors.q}"
    textColor: "{colors.onAcc}"
    rounded: "{rounded.card}"
    padding: "1px 7px"
  repo-row:
    backgroundColor: "transparent"
    textColor: "{colors.tx}"
    rounded: "{rounded.row}"
    padding: "4px 7px"
  repo-row-on:
    backgroundColor: "{colors.panel3}"
    textColor: "{colors.tx}"
    rounded: "{rounded.row}"
    padding: "4px 7px"
  file-row:
    backgroundColor: "transparent"
    textColor: "{colors.tx2}"
    rounded: "{rounded.row}"
    padding: "3px 7px 3px 28px"
  file-row-on:
    backgroundColor: "{colors.sel}"
    textColor: "{colors.tx}"
    rounded: "{rounded.row}"
    padding: "3px 7px 3px 28px"
  file-card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  file-card-head:
    backgroundColor: "{colors.panel3}"
    textColor: "{colors.tx}"
    padding: "7px 11px"
  hunk-head:
    backgroundColor: "{colors.panel2}"
    textColor: "{colors.tx3}"
    typography: "{typography.meta}"
    padding: "0 11px"
    height: "26px"
  hunk-context:
    backgroundColor: "transparent"
    textColor: "{colors.tx2}"
    rounded: "{rounded.hunk}"
    padding: "1px 7px"
  diff-gutter:
    backgroundColor: "transparent"
    textColor: "{colors.ln}"
    typography: "{typography.code}"
    padding: "0 11px 0 0"
    width: "42px"
  diff-code:
    backgroundColor: "transparent"
    textColor: "{colors.code}"
    typography: "{typography.code}"
    padding: "0 10px"
  overlay:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.tx}"
    rounded: "{rounded.modal}"
  toast:
    backgroundColor: "{colors.panel3}"
    textColor: "{colors.tx}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
---

# Design System: diffalanche

## Overview

**Creative North Star: "The Quiet Control Room"**

diffalanche is read for hours at a stretch by one person checking what a set of
coding agents did to a dozen repositories. The interface is the room they read
in: dark by default, low in contrast everywhere except where it matters, and
built out of instruments rather than pages. Everything countable — a path, a
line number, a count, a hotkey, a severity — is set in monospace, so the eye can
tell a measurement from a sentence without reading either. Panels have fixed
widths and never move. Nothing spins, nothing blinks, and nothing reflows after
data arrives.

The palette is deliberately quiet so that one thing can be loud. The accent is a
muted periwinkle, not a saturated blue; added and removed lines are 15–17 %
washes of green and clay, not the saturated bands a hosted diff viewer uses; the
four severity colours are desaturated to the point where a filled `critical`
badge is the single most saturated object on a full screen. That is the whole
colour argument: a finding outranks the code it sits in, and it can only do that
if the code is calm.

Both themes are first-class and neither is a tint of the other. The dark theme
is cool graphite; the light theme is warm paper — an ivory ground with warm
greys, chosen against the cool blue-white a developer tool defaults to, so that
switching themes changes the room rather than inverting the picture.

**Key Characteristics:**

- Dark by default; the light theme is warm paper, not cool white.
- Dense: a 9.5–14.5 px type ramp, 1 px borders, a spacing core of 9–14 px.
- Monospace carries everything countable; the sans carries what a human wrote.
- Flat inside the workspace; shadows lift only modals and the toast.
- Fixed panel widths (308 / flexible / 392) and a 1560 px floor — the layout
  never compresses.
- Text symbols instead of icons; the mark is three squares built in markup.

## Colors

Two themes, both normative. In the frontmatter, the dark theme is keyed by the
CSS variable name (`acc`, `panel2`, `crit`) and the light theme by the same name
plus `-light` (`acc-light`); the values are the ones in `src/ui/tokens.css` and
change there first.

### Primary

- **Muted Periwinkle** / **Ink Indigo** (`acc`): the one accent. Active states,
  the primary action, the focused thread, the selected search result, the
  `question` severity, and the caret in every menu trigger. It is a blue that
  has had most of its saturation taken out, so it reads as attention rather than
  as a link.
- **Accent Ground** (`accBg`) and **Accent Edge** (`accBd`): the wash and border
  of anything currently in play — the selected line range, an agent's reply, the
  model's re-anchoring proposal, a focused field. `accTx` is the text that sits
  on that wash.

### Secondary — the severity voices

- **Faded Terracotta** / **Deep Terracotta** (`crit`): `critical`. The most
  saturated colour permitted on screen, and the reason everything else is quiet.
- **Dim Amber** / **Burnt Amber** (`warn`): `warning`, and the scanner's
  warnings bar and orphaned threads.
- **Pale Sage** / **Deep Sage** (`nit`): `nit`.
- **Muted Periwinkle** (`q`): `question` — deliberately the same value as the
  accent. A question is a request for attention, not a defect.
- **Living Green** (`ok`): `Resolve` and the pulsing `watching` dot. The only
  colour attached to something that is alive rather than something that is
  wrong.

### Tertiary — the diff

- **Pale Mint** (`addTx`) on a 15 % green wash (`add`), **Pale Clay** (`delTx`)
  on a 15 % clay wash (`del`): added and removed lines. The washes are washes;
  a saturated band would out-shout every badge on the screen.
- **Reading Grey** (`code`) for context lines and **Gutter Grey** (`ln`) for
  line numbers: unchanged code is background, and its numbers are further back
  still.
- **Filler** (`gap`): the empty half of a split-diff row. It is the header tone,
  not a new colour — an absence, not a state.

### Neutral

- **Graphite Night** / **Warm Paper** (`bg`): the application ground and the
  centre panel.
- **Slate Panel** / **Bright Paper** (`panel`): the sidebar, the thread rail, a
  file card.
- **Chrome** (`panel2`): the header, the status bar, hunk headers, secondary
  plates. **Raised Chrome** (`panel3`): a file card's header, controls, chips,
  the active repository, the active segment.
- **Divider** (`bd`) for every border and **Hairline** (`bd2`) for internal
  splits and the seam between diff columns.
- **Primary Text** (`tx`), **Secondary Text** (`tx2`), **Tertiary Text** (`tx3`)
  — the last carries timestamps, counts, and captions.
- **Selection** (`sel`): the selected file in the tree, and nothing else.
- **On Accent** (`onAcc`): the text on any filled accent or severity.
- **Scrim** (`scrim`): the ground under a modal.

### Named Rules

**The One Loud Thing Rule.** A filled `critical` badge is the most saturated
object permitted on a screen. Any new colour is checked against it: if it
competes, it is wrong, whatever it is for.

**The Selection Rule.** `sel` marks the file the reader is in. `accBg` marks
what is in play right now — a dragged line range, a focused thread, a
highlighted search hit. They are never used for each other's job.

## Typography

**Display Font:** Instrument Sans (with `system-ui, sans-serif`)
**Body Font:** Instrument Sans (with `system-ui, sans-serif`)
**Label/Mono Font:** JetBrains Mono (with `ui-monospace, monospace`)

Both families are bundled as local `woff2` subsets: the tool works offline and
the page asks no font host for anything. JetBrains Mono also ships cyrillic,
because the interface has Russian strings.

**Character:** two workhorses, divided by job rather than by rank. Instrument
Sans is the voice of a person — comment bodies, empty-state headings, prose.
JetBrains Mono is the voice of the machine — every path, count, line number,
hotkey, severity chip, and the diff itself, including the wordmark. The result
reads as an instrument panel with human notes pinned to it.

### Hierarchy

- **Display** (600, 19 px, 1.25, `-0.01em`): empty-state and export headings.
  The largest type in the product; there is no hero and nothing above it.
- **Headline** (mono 600, 14.5 px, 1.3): the repository path over a change set.
- **Title** (mono 600, 13.5 px, 1, `-0.02em`): the `diffalanche` wordmark.
- **Body** (400, 13 px, 1.5): interface prose and comment bodies (1.6 in a
  thread card).
- **Meta** (mono, 11 px, 1.5): counts, the `<branch> ← <base> · merge-base <sha>`
  line, hunk headers, feed events, tree file rows.
- **Label** (mono, 10 px, `0.07em`): the uppercase tags — `BASE`, `SCAN`,
  `AGENT ACTIVITY`, `FROM YOUR HISTORY` — and key chips. Severity chips are the
  same family at 9.5–10 px, 600, `0.04em`.
- **Code** (mono, 12 px / 22 px): the diff. 11.5 px / 20 px in the tighter
  layout.

The full working ramp is 9.5 · 10 · 10.5 · 11 · 11.5 · 12 · 12.5 · 13 · 13.5 ·
14.5 · 17 · 19 px. It is a dense ramp on purpose: the screen holds a change set,
not an article.

### Named Rules

**The Countable-Is-Mono Rule.** Anything a person could count, copy, or type
back — a path, a line number, a sha, a count, a hotkey, a severity — is set in
JetBrains Mono. Anything a person wrote in words is set in Instrument Sans. A
count in the sans face is a bug.

**The No-Larger-Than-Nineteen Rule.** 19 px is the ceiling. The product has no
hero and nothing to announce; type that reaches for attention is taking it from
a finding.

## Layout

A vertical flex column at full height: header 52 px, an optional scanner
warnings bar, the workspace, status bar 30 px. The workspace is three columns —
sidebar 308 px, centre flexible, thread rail 392 px — with 1 px borders between
them.

The page is one vertical scroll. The header, both side panels, and the status
bar are `sticky`, so the document scrolls and a file card is reached with
`scrollIntoView`. Inside the centre panel, each file card owns one horizontal
scroll at least 1080 px wide, so a long line moves the whole diff and the two
columns stay aligned; the composer inside it is `position: sticky; left: 0` and
stays in view while that scroll moves.

**Spacing** runs 4 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 14 · 16 · 18 · 22 px, with
the core between 9 and 14. The header pads `0 15px` with a 13 px gap; the centre
panel pads `12px 16px 60px`; a file card's header pads `7px 11px`; the diff
gutter is 42 px wide, right-aligned, with 11 px of clearance before the code.

**Responsive behaviour: there is none, deliberately.** `.app` has
`min-width: 1560px`. Below that the window scrolls sideways and the panels keep
their widths, because a two-column diff stops being readable before anything
else on the screen does. This is a desktop tool for one person on `127.0.0.1`;
it does not adapt to a phone and must not be made to.

### Named Rules

**The Panels-Do-Not-Shrink Rule.** 308 / flexible / 392 are fixed. Below
1560 px the window scrolls; nothing compresses, nothing collapses, nothing
becomes a drawer.

**The No-Jump Rule.** The panels hold their final widths while the server
answers. Loading shows the real header, silhouette rows in the sidebar, and one
empty file card — never a spinner, and never a layout that moves when the data
lands.

## Elevation & Depth

The system is flat inside the workspace. Depth in the plane of the screen is
tonal only: the `bg` → `panel` → `panel2` → `panel3` ladder, plus borders that
are always exactly 1 px. A raised control is raised by tone, never by shadow.

Shadows exist for exactly one job: lifting something out of that plane. There
are two, and nothing else casts one.

### Shadow Vocabulary

- **Modal** (`box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5)`; light theme
  `0 20px 48px rgba(70, 64, 54, 0.2)`): the base picker, the sessions menu,
  global search, the export dialog — anything sitting over the scrim.
- **Toast** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4)`; light theme
  `0 10px 26px rgba(70, 64, 54, 0.16)`): the transient message at the bottom
  centre, which floats without a scrim.

### Named Rules

**The Flat Workspace Rule.** A surface that stays in the workspace gets a tone
and a 1 px border, never a shadow. If a new element wants a shadow, either it
belongs over the scrim or the shadow is wrong.

**The One-Pixel Rule.** Every border is 1 px. Weight is carried by colour —
`bd` for a real edge, `bd2` for an internal split — not by thickness. The only
exception is the severity marker on a commented line, which is
`box-shadow: inset 3px 0 0 <severity>`, an inset bar rather than an elevation.

## Shapes

Rectangles with small radii, scaled to the size of the thing: 2.5 px on the
logo's squares, 4 px on tags and key chips, 5 px on the hunk's context button,
6 px on a segment group, 7 px on list rows and tabs, 8 px on buttons, fields,
the session pill and the toast, 9 px on thread cards and count badges, 10 px on
a file card and the panels, 12 px on modals. Nothing is a circle except the 7 px
status dots.

The form language is the plate: a rectangle with a 1 px border and a tonal fill,
sized to its content and aligned to its neighbours. There are no cut corners, no
clipping masks, no decorative geometry, and no gradients anywhere in the system.

**Motion** is two keyframes and no more. `dcin` — `opacity 0→1` with
`translateY(4px)→0` over 140–160 ms ease-out — is how anything appears: an
overlay, the composer, a new thread, the model's proposal. `dcpulse` —
`opacity 1→0.35→1` over 2.4 s ease-in-out, infinite — marks something alive: the
`watching` dot and the live agent indicators, at 1.1 s while the model is
searching. Nothing else animates; a data update repaints the affected lines and
threads, never the card.

### Named Rules

**The Two-Keyframe Rule.** `dcin` for arrival, `dcpulse` for a heartbeat. A
third animation is a new decision, not a flourish.

## Components

Quiet and instrumented: transparent by default, 1 px border, and fill reserved
for state. Every control is 26–28 px tall, so a row of them lines up without
adjustment.

### Buttons

- **Shape:** 8 px radius (`{rounded.control}`), 28 px tall.
- **Ghost** (the default, and almost the only kind on screen): transparent
  background, 1 px `bd` border, `tx2` text, `0 10px` padding, 7 px gap between
  glyph and label. `Export .md`, `Browse repo`, `Comment on repo`, `dismiss`.
- **Primary:** filled `acc` with `onAcc` text. One per context at most: the
  `Comment` button in the composer, `Apply` in the base picker, `Create` for a
  session, `Спросить модель` on an orphaned thread.
- **Resolve:** filled `ok` with `onAcc` text; `Reopen` is the ghost variant of
  the same control.
- **Segments** (`split`/`unified`, `☾`/`☀`, `working tree`/`base <sha>`): a
  6 px-radius group with a shared 1 px border, 26x26 cells, the active one
  filled `bd` with `tx` text.

### Chips and badges

- **Tag** (`BASE`, `SCAN`, `MODEL`, `CURRENT`): mono 10 px, `0.07em`, `tx3`,
  either bare or in a 4 px-radius 1 px-bordered plate.
- **Key chip** (`⌘K`, `esc`, `↵`): 4 px radius, 1 px `bd` border, `tx3`,
  `1px 4px`.
- **Severity chip:** filled with its severity colour, `onAcc` text, mono 9.5 px
  600 at `0.04em`.
- **Count badge:** 9 px radius, `1px 7px`, filled with the worst severity among
  the comments it counts (`tx3` when there is none), mono 600 10 px.

### Cards and containers

- **File card:** 10 px radius, 1 px `bd` border, `panel` background, `overflow:
  hidden`, 10 px below it. Its header is `panel3` with a `bd` bottom border and
  `7px 11px` of padding.
- **Thread card:** 9 px radius, 1 px `bd` border on `panel3`. Focused: `accBd`
  border on `accBg`. Resolved: `opacity 0.55`. Orphaned: `warn` border. Replies
  nest inside — an agent's on `accBg` inside an `accBd` border with `accTx`
  authorship, a human's on `panel2`.
- **Overlay:** 12 px radius, 1 px `bd` border, `panel` background, the modal
  shadow, entering with `dcin` 160 ms. The scrim closes it on a click and on
  `esc`; the panel itself does not.
- **Toast:** 8 px radius on `panel3` with the small shadow, `9px 14px`, bottom
  centre, 2.2 seconds.

### Inputs and fields

- **Style:** 1 px `bd` border, 8 px radius, `panel2` ground, 28 px tall for a
  single line; the composer's textarea is 72 px with a 9 px radius on `panel`.
- **Focus:** the border becomes `accBd`. Interactive rows that have no border of
  their own take `outline: 1px solid var(--accBd)` on `:focus-visible` instead.
  Focus is always visible and always `accBd`; it is never removed and never a
  glow.

### Navigation

- **Tabs** (`changes`/`all files`, `This file`/`Review`): 7 px radius,
  `4px 9px`, `tx2`; active is filled `panel3` with `tx` text. The rail's tabs
  mark the active one with `box-shadow: inset 0 -2px 0 var(--acc)` instead of a
  fill.
- **Tree rows:** 7 px radius, full width, mono. A repository row is `4px 7px`
  and 12 px 500; a file row is `3px 7px 3px 28px` and 11 px. Hover is `panel2`;
  the active repository is `panel3`; the selected file is `sel` with `tx` text.

### The diff

The library renders the rows; the system dresses them. Two 50 % columns split by
a `bd2` seam, a 42 px right-aligned gutter in `ln` with 11 px of clearance, code
in `code` at 12 px / 22 px with `white-space: pre`. An added row is `addTx` on
`add`, a removed row `delTx` on `del`, an empty split half is `gap`. A hunk
header is `panel2`, 26 px tall, mono 11 px in `tx3`. A selected range is `accBg`
with `inset 3px 0 0 var(--acc)`; a commented line carries the same bar in its
severity colour.

### The mark

Three 9x9 squares at a 2.5 px radius, stepped 5 px along the diagonal in `acc`,
`warn`, and `nit`, inside a 19x19 box — the three severities, offset like a
stack of changes. It is built in markup and scales by ratio; the favicon is the
same mark as an inline SVG data URI. There is no raster file.

## Do's and Don'ts

### Do:

- **Do** take every colour from `src/ui/tokens.css`. It and this file carry the
  same values and change in the same pass; a hard-coded hex in a component is a
  defect.
- **Do** set anything countable in JetBrains Mono and anything a human wrote in
  Instrument Sans (The Countable-Is-Mono Rule).
- **Do** give a new surface a tone from the `bg`/`panel`/`panel2`/`panel3`
  ladder and a 1 px `bd` border (The Flat Workspace Rule).
- **Do** keep both themes in step. A token added for one theme is added for the
  other in the same edit, and light is designed as warm paper, not as inverted
  dark.
- **Do** show focus with `accBd` — a border change on a bordered control, a 1 px
  outline on a row that has none.
- **Do** use `dcin` for anything that appears and `dcpulse` for anything alive.
- **Do** keep panel widths fixed and let the window scroll below 1560 px.
- **Do** use text symbols (`▾ ▸ ⌕ ☾ ☀ ✓ ↑ ↓ ↵ ⏎ ⌘ ⇧ ◆`) for iconography.

### Don't:

- **Don't** add a colour more saturated than a filled `critical` badge (The One
  Loud Thing Rule).
- **Don't** put a shadow on anything that stays in the workspace; the two
  shadows are for modals and the toast.
- **Don't** use a gradient, a glow, a coloured drop shadow, or gradient text
  anywhere. The system has none and wants none.
- **Don't** use a border other than 1 px (The One-Pixel Rule); the severity
  marker is an inset bar, not an exception to it.
- **Don't** ship a spinner, a skeleton shimmer, or a layout that moves when data
  arrives (The No-Jump Rule). Loading is the real header, silhouette rows, and
  one empty card.
- **Don't** repaint a file card on a live update; change the affected lines and
  threads and let `dcin` carry them in.
- **Don't** add a breakpoint, a collapsing panel, or a mobile layout.
- **Don't** add an icon font, a raster asset, or a third font family.
- **Don't** set type above 19 px, and don't reach past the 9.5–19 px ramp for
  emphasis — use weight, the mono face, or a severity colour.
- **Don't** use `sel` and `accBg` interchangeably (The Selection Rule).
