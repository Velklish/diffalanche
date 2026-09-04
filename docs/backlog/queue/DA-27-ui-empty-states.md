# DA-27 · Empty states

- **Order:** 270
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-24

## Context

`docs/design/HANDOFF.md` section 10: "no changes" (title, explanation, `Change base` and `Other session` buttons) and "first run" when no session exists (logo mark, title, three metric cards — repositories found, with changes, worktrees — a name field with the BASE button and `Create`, and the CLI hint `diffalanche review new <name> --base branch`).

## Work to do

- First-run screen bound to the sessions API and the base picker; creating a session from it opens the review.
- No-changes screen in the centre panel when the current session's change set is empty; buttons open the base picker and the sessions menu.
- Metrics from a lightweight `GET /api/scan` that lists repositories without diffs.

## Out of scope

- Any other screen.

## Verification

- Playwright: a data directory without sessions shows the first-run screen with the fixture's counts; creating `ls-1` there makes it current and shows the review; a session in `ref` mode with a ref that changes nothing shows the no-changes screen and `Change base` opens the picker.
