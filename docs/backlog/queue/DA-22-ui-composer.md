# DA-22 · Line selection and composer

- **Order:** 220
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-21

## Context

`docs/design/HANDOFF.md` section 2 and "Interactions & Behavior": `mousedown` on a new-side line starts a selection, `mouseenter` extends, `mouseup` fixes it and opens the composer under the last line; shift-click extends; no `+` buttons. The composer is a sticky full-width strip with the anchor line, severity chips (manual only in the MVP, `warning` preselected — the `AUTO` chip appears in Phase 2), a 72 px field, `Comment` / `Cancel`, ⌘⏎ to send, `esc` to close. `docs/SPEC.md` section 5: comments on a line, range, file, repository, or the whole review.

## Work to do

- Selection model in the store (`sel`, `dragging`, `composer`, `composerEnd`), `user-select: none` on the diff while dragging, range highlight `--accBg` with the 3 px accent bar.
- Composer component in the file card's slot; posting through `POST /api/comments` with side, line, endLine; the anchor is filled by the server from the change set.
- Entry points: drag, click, `C` on the first added line of the current file, `Comment on repo` in the repository header, and a `Comment on review` action in the header's session menu; file-level comment from the file card header.
- Toast `Comment saved to reviews/<name>/comments.json`; the new thread appears through the store immediately.

## Out of scope

- Suggestions from history and `AUTO` (DA-36).

## Verification

- Playwright: dragging L41 to L43 opens the composer with `L41–43 · 3 lines`; sending creates a comment whose `line` and `endLine` in `diffalanche list --json` are 41 and 43; `esc` closes without a comment; ⌘⏎ sends; a repository-level comment has `path: null`.
- Composer open time ≤ 50 ms in the perf harness.
