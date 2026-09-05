# DA-20 · Sidebar navigation

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-19
- **Taken:** 2026-09-05

## Context

`docs/design/HANDOFF.md` section 1.3: tabs `changes` / `all files` (the second is Phase 2 and stays hidden), filter field with a match count, a tree of repositories with the open-comment counter in the colour of the worst severity and the file count, files indented with `+N` / `−N` and a comment badge, selected file and active repository highlights, footer with the pulsing dot and `watching · 127.0.0.1:<port>`. `docs/SPEC.md` section 5: the user jumps to any repository or file and sees comments per file; jump budget 50 ms.

## Work to do

- Tree built from the store's change set and comment counters; expand and collapse per repository; keyboard focus order.
- Filter by substring over repository and file names with the count on the right; empty result state.
- Selecting a file scrolls the centre panel to its card and sets `repo` and `path` in the store; the current file follows the centre panel's scroll position.
- Footer status from the SSE connection state (DA-25 wires it; here a static `watching`).

## Out of scope

- `all files` tab and browsing (DA-37).

## Verification

- Playwright on the small fixture: the tree lists every repository with changes and no repository without; clicking a file scrolls its card into view within 50 ms measured by the perf harness; the filter narrows the tree and the count matches.
- Badges equal `diffalanche list --json` counts per file.
