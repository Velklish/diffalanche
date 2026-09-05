# DA-26 · Keyboard map and global search

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-22, DA-23
- **Taken:** 2026-09-05

## Context

`docs/design/HANDOFF.md` "Keyboard map" and section 6: ⌘K / Ctrl+K and double Shift open global search, ↑ / ↓ / ⏎ inside it, J / K move between open threads across repositories, C opens the composer on the first added line, R resolves the focused thread, B toggles browsing (Phase 2 — no-op with a hint in the MVP), ⌘⏎ sends, esc closes everything; hotkeys are inactive in inputs except the listed ones. Global search in the MVP covers files and comments of the review with a 12-line preview; symbols and text come in Phase 2 (`docs/SPEC.md` section 3, decision 13).

## Work to do

- A keyboard controller in the store with the focus rules of the handoff; status bar hints.
- Global search modal: 880 px × 60 vh, input autofocus, results column with tags `file` and `comment`, preview column with the target line highlighted; ranking by substring and word overlap; `⏎` opens the file and scrolls to the line or focuses the thread; mouse hover selects.
- J / K order: by repository, file, and line across the whole review; wrap-around; the rail follows.

## Out of scope

- `symbol` and text results (DA-38, DA-39); B browsing (DA-37).

## Verification

- Playwright: each row of the keyboard map performs its action on the fixture; `⌘K` opens the search, typing a file name lists it, `⏎` scrolls its card into view; typing a comment word lists the comment with its preview; `J` from the last open thread wraps to the first; hotkeys do nothing while typing in the composer except ⌘⏎ and esc.
