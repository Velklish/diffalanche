# DA-21 · Diff view: file cards, split and unified, hunks

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-19
- **Taken:** 2026-09-05

## Context

`docs/design/HANDOFF.md` section 1.4: repository header (path, `<branch> ← <base> · merge-base <sha>`, counts, `Comment on repo`), file card (header with caret, path, comment badge, `new file` chip, `split` / `unified` segments), hunk header with `↑ N lines` / `collapse context`, two 50 % columns, 42 px gutter, one horizontal scroll per file. The diff library renders the lines; the project renders the framing. Virtualisation and library are fixed by the DA-3 verdict ADR. Budgets: first render 500 ms, scrolling with zero long tasks.

## Work to do

- File card and repository header components over `@git-diff-view/react` (or the verdict's choice) with the handoff's tokens: line backgrounds `--add` / `--del`, gutter colour `--ln`, hunk header on `--panel2`.
- Split and unified toggle per file, remembered in the store; collapse and expand of a file card.
- Hunk context expansion using the diff's context lines available in the bundle; the `↑ N lines` control asks the server for more context in Phase 2 and is limited to what the bundle holds now.
- Slots for the range highlight, the composer row, and inline thread widgets (used by DA-22 and DA-23).
- Chips: `new file`, `deleted`, `renamed`, binary and oversized files listed without content.

## Out of scope

- Selection and composer (DA-22); threads (DA-23); browsing unchanged files (DA-37).

## Verification

- The DA-5 performance job is green on the synthetic review with the full diff rendered: first render ≤ 500 ms, zero long tasks while scrolling.
- Playwright: split and unified views show the same line numbers for a three-hunk file; a file with 2 000 lines has one horizontal scrollbar and aligned columns.
