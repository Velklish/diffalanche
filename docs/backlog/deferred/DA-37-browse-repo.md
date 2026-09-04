# DA-37 · Browse repo: all files, working tree and base revision

- **Scope:** 08-ui, 07-server, 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-26

## Context

`docs/SPEC.md` section 5 Phase 2: open any file of a repository at the base revision or the working tree and expand the context around a hunk. `docs/design/HANDOFF.md` section 8: the `all files` sidebar tab, `unchanged` marks, read-only file view with `working tree` / `base <sha>` segments, comments allowed there, entry by `Browse repo`, `B`, or global search, exit by `← back to review`.

## Work to do

- Server: `GET /api/repos/:repo/tree` (`git ls-tree` at base and working tree merged), `GET /api/repos/:repo/file?path=&rev=` (`git show` or the working tree), and context expansion for hunks from the full file.
- UI: the `all files` tab, the file view with numbering from 1, comments on unchanged files stored with the same anchor shape, the `↑ N lines` control wired to real context.
- Keyboard `B` and the file card's `Browse repo` button.

## Out of scope

- Search inside files (DA-38).

## Verification

- Playwright: an unchanged file opens read-only with `not in this review`; a comment left there appears in `list --json` with its path; `↑ 20 lines` above a hunk shows the real preceding lines of the working tree.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.
