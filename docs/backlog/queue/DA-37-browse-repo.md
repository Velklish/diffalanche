# DA-37 · Browse repo: all files, working tree and base revision

- **Order:** 370
- **Scope:** 08-ui, 07-server, 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-26

## Context

`docs/SPEC.md` section 5 Phase 2: open any file of a repository at the base revision or the working tree and expand the context around a hunk. `docs/design/HANDOFF.md` section 8: the `all files` sidebar tab, `unchanged` marks, read-only file view with `working tree` / `base <sha>` segments, comments allowed there, entry by `Browse repo`, `B`, or global search, exit by `← back to review`.

## Work to do

- Server: `GET /api/repos/:repo/tree` (`git ls-tree` at base and working tree merged), `GET /api/repos/:repo/file?path=&rev=` (`git show` or the working tree), and context expansion for hunks from the full file.
- UI: the `all files` tab, the file view with numbering from 1, comments on unchanged files stored with the same anchor shape, the `↑ N lines` control wired to real context.
- Keyboard `B` and the file card's `Browse repo` button.

## What Phase 1 changed

Phase 1 left the door this task opens: `B` in `src/ui/keys.ts` shows a toast naming this task and does nothing else; the file card header (DA-22) is where `Browse repo` goes. Routes under `/api/repos/:repo/…` must be registered before the `/api/repos/:repo{.+}/diff` pattern in `src/server/app.ts`, as `GET /api/repos/branches` is. The sidebar tree (DA-21) and the file-card virtualisation ([ADR-008](../../adr/adr-008-diff-rendering-verdict.md)) are what an `all files` view joins; the live update patches by object identity (`src/ui/patch.ts`, DA-25), so a file opened from the tree must not break `mergeRepository`'s identity rule. Git is read only through the `git` binary ([02-git.md](../../reference/02-git.md)); the tool never writes to a repository.

## Out of scope

- Search inside files (DA-38).

## Verification

- Playwright: an unchanged file opens read-only with `not in this review`; a comment left there appears in `list --json` with its path; `↑ 20 lines` above a hunk shows the real preceding lines of the working tree.

