# DA-56.7 · The focus ring is accBd, and accBd is 1.6 to 2.0:1 against every ground it is drawn on

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Dependencies:** none
- **Parent:** DA-56.2
- **Cost:** major

## Context

Found by DA-56.2, which measured the non-text indicators of the interface
against WCAG 1.4.11 (3:1) for the first time, as part of the batch DA-113. Every
coloured mark that carries a state clears the bound with room to spare — the
history mark, the tick and its unpicked `·` are 4.7:1 or more in both themes —
and one does not: the focus ring.

`DESIGN.md` made the ring `accBd` everywhere, and said so as a rule (at `5a5f8e8`):

```md
- **Focus:** the border becomes `accBd`. Interactive rows that have no border of
  their own take `outline: 1px solid var(--accBd)` on `:focus-visible` instead.
```

Measured with the formula of `tests/design-contrast.test.ts`, the token against
each ground a focusable control sits on:

| `accBd` on | dark | light |
|---|---:|---:|
| `bg` | 1.95 | 1.83 |
| `panel` | 1.86 | 2.00 |
| `panel2` | 1.81 | 1.77 |
| `panel3` | 1.65 | 1.63 |

On a row of the tree, a tab, a menu row, a search hit or a thread, the 1 px
`accBd` outline is the **only** thing that says where the ring is; on a bordered
control it is a border that changes from `bd` to `accBd`. WCAG 1.4.11 counts a
focus indicator as the visual information that identifies a state, and asks 3:1
of it against what is next to it. `PRODUCT.md` makes the keyboard path one of the
two accessibility needs the product has ("the review loop … is usable from the
keyboard alone"), and the ring is what that path is read by.

The test now carries these eight pairs as recorded exceptions
(`BELOW_NON_TEXT`), so a new pair under the bound fails, and so does one of these
clearing it. DA-56.2 could not change them: choosing colours was out of its
scope, and the ring is a rule of `DESIGN.md`, not a local value.

The surface brief already notes that the focus treatment has not had a keyboard
walk; this entry is the number that walk would have found.

### The token today and three candidates

Measured with the WCAG formula of `tests/design-contrast.test.ts` against the
values in `src/ui/tokens.css` on this tree. `accBg` is not one of the four
grounds the test holds — a focused row of the history sits on it — and is shown
for information. Hue, saturation and lightness are HSL.

| theme | candidate | value | H / S / L | `bg` | `panel` | `panel2` | `panel3` | `accBg` |
|---|---|---|---|---:|---:|---:|---:|---:|
| dark | `accBd` today | `#3f4a80` | 230° / 34 % / 37.5 % | 1.95 | 1.86 | 1.81 | 1.65 | 1.71 |
| dark | A · `acc` | `#8b9ae0` | 229° / 58 % / 71.2 % | 6.06 | 5.78 | 5.64 | 5.15 | 5.34 |
| dark | B · `accTx` | `#a8b3e6` | 229° / 55 % / 78.0 % | 7.98 | 7.60 | 7.42 | 6.77 | 7.02 |
| dark | C · `accBd` lightened | `#6c79b7` | 230° / 34 % / 57.0 % | 3.93 | 3.75 | 3.66 | 3.34 | 3.46 |
| light | `accBd` today | `#aab2d8` | 230° / 37 % / 75.7 % | 1.83 | 2.00 | 1.77 | 1.63 | 1.72 |
| light | A · `acc` | `#4d5793` | 231° / 31 % / 43.9 % | 5.95 | 6.49 | 5.74 | 5.29 | 5.59 |
| light | B · `accTx` | `#3a4478` | 230° / 35 % / 34.9 % | 8.09 | 8.83 | 7.81 | 7.20 | 7.61 |
| light | C · `accBd` darkened | `#6977ba` | 230° / 37 % / 57.2 % | 3.73 | 4.07 | 3.60 | 3.31 | 3.50 |

- **A — `acc`.** No new colour: it is already the accent of the focused thread,
  the caret and the selected search hit. Clears 3:1 by 5.15 at the tightest.
  The ring would read as loud as the accent itself.
- **B — `accTx`.** Also an existing token, the heaviest of the three (6.77 at the
  tightest). A ring in the text colour of the accent wash is the strongest
  departure from today's quiet ring.
- **C — `accBd` moved in lightness only**, same hue and saturation, stepped by
  0.5 % until the tightest ground (`panel3`) cleared 3.3:1 rather than exactly
  3:1, so that rounding of a hand-edited value cannot put it back under. At the
  bare 3:1 the steps stop at `#6572b3` (dark, 3.04 on `panel3`) and `#707ebe`
  (light, 3.03). It is a new value, so either a new token for the ring or a
  change of `accBd` itself — which also borders the focused thread and an
  agent's reply, where it frames a wash rather than marking the ring.

**Closest to today's shade: C.** All three share today's hue (229–231°); C alone
keeps its saturation as well and moves only lightness, 19.5 points in the dark
theme and 18.5 in the light one, against 33.7 and 31.8 for A.

**Decision (owner, 2026-09-23): C** — `accBd` itself takes `#6c79b7` dark and `#6977ba` light.
**Decision (owner, 2026-09-23, after review): the ring is `acc`** — C left `bd` and `sel` under 3:1; `accBd` keeps C for edges.

## Work to do

- Choose one of A, B or C above. Any of them is a change to `DESIGN.md`'s focus
  rule and its Do's and Don'ts, made there first, and C is also a new value in
  `tokens.css` and `DESIGN.md`'s frontmatter together.
- Apply it to every `:focus-visible` rule in `src/ui/styles.css` that names
  `accBd`, and remove the exceptions from `BELOW_NON_TEXT` in the same pass.

## Out of scope

- A value of its own for the frames `accBd` draws — the border of a focused
  *thread*, of an agent's reply, of a thing in play. They are not left as they
  were: they take C with the token (`#6c79b7` dark, `#6977ba` light), held at 3:1
  against `panel` and `accBg`, while the ring itself is drawn in `acc`.
- Text contrast, which the same test already holds at 4.5:1.

## Verification

- `tests/design-contrast.test.ts` with `BELOW_NON_TEXT` empty, in both themes.
- A keyboard walk over the header, the tree, the rail and an overlay in both
  themes, with a screenshot per theme in the result.
