# DA-6 · Repository scanner

- **Scope:** 01-scanner (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-1
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 3, decision 3: a repository is any directory with `.git` (directory or worktree file) at most `depth` levels below each entry of `roots`; a found repository is not scanned inside; it is identified by its path relative to the root. Configuration comes from `config.json` (section 7): `roots`, `depth`, `exclude`.

## Work to do

- `src/core/scanner`: `scan(root, config)` returns repositories with relative path, absolute path, kind (`repo` or `worktree`), and a list of warnings.
- Detection of `.git` as a directory and as a file (worktree pointer); no descent into a found repository; `exclude` globs applied to directory names; symlinks are not followed.
- Warnings: a worktree whose main repository is also under the root ("worktree of <repo>"), an unreadable directory.
- Type definitions for repository and warning in `src/core/types.ts`, shared by the CLI and the server.

## Out of scope

- Reading diffs (DA-7); watching for changes (DA-12).

## Verification

- Vitest on the small synthetic profile and a hand-made fixture: `repos/<group>/<repo>` are listed with `group/repo` ids; a sibling worktree is listed as its own repository with a warning; a submodule and a worktree nested inside a repository are not listed; a directory deeper than `depth` is not listed.
- `git status --porcelain` of every fixture repository is identical before and after a scan.
