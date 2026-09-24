# DA-36.1 · The chosen suggestion is not announced to a screen reader

- **Scope:** 08-ui
- **Created:** 2026-09-24
- **Parent:** DA-36
- **Cost:** minor

## Evidence

Finding discovered while working on DA-36, in the Impeccable audit of the composer.
`↑` / `↓` move the choice among the suggestion rows while the caret stays in the
field, and the chosen row is marked only by `aria-current` on a button that
never takes focus:

<!-- quote:../../../src/ui/Composer.tsx -->
      aria-current={on ? "true" : undefined}
      tabIndex={-1}
<!-- /quote -->

Nothing ties the field to the list — no `aria-activedescendant`, no live region
— so a screen reader user typing in the field hears nothing when the choice
moves, and learns what `TAB` took only by reading the field back. A live region
that speaks every answer would be louder than the rows are useful while typing;
the likely shape is one that speaks the chosen row when a key moved it, not when
an answer arrived.

The same holds for two changes the form makes on its own (review of DA-36): the
server's sentence when `GET /api/suggest` answers 503, which appears in the
first slot of the panel, and `AUTO` going out of reach with the severity moved
to `WARNING`. Neither is in a live region, so a reader who does not see the
form learns of neither — and `WARNING` is then what `⌘⏎` sends. Since `TAB` now
takes only a row the arrows chose, a draft is no longer replaced unheard; the
choice itself still is not announced.
