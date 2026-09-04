# DA-7 · Git diff reader: three base modes

- **Order:** 70
- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-6

## Context

`docs/SPEC.md` section 3, decision 4: `head` (working tree against HEAD), `branch` (against the merge base of HEAD and the remote default branch or the branch named by `base.branch`; fallback to the default branch with a warning; like `head` without a remote), `ref` (an explicit ref; repositories where it does not resolve are skipped with a warning). Untracked files are part of the diff. The tool never changes index, working tree, or history.

## Work to do

- `src/core/git`: run the `git` binary through `node:child_process` (no libgit2); helpers for `rev-parse`, `symbolic-ref` of the remote HEAD, `merge-base`, `diff` with `--no-color --no-ext-diff -U3`, `ls-files --others --exclude-standard` for untracked files rendered as additions.
- Resolution of the base per repository for each mode, returning the resolved base (ref name and sha), the branch, and warnings.
- Parsing of unified patches into the structured shape used by `diff --json` and `diff.json`: files with old and new path, status (added, deleted, modified, renamed), hunks with header and lines with old and new numbers. Use the parser of the chosen diff library if it exposes one; otherwise a small dedicated parser with tests.
- Binary files and files larger than a configurable limit are listed without content.

## Out of scope

- Full-file content for browsing (Phase 2); caching to disk (DA-8 and DA-12).

## Verification

- Vitest on fixture repositories: `head` shows working-tree and untracked changes; `branch` on a feature branch with commits ahead of the remote default branch and a clean working tree shows the committed changes; `branch:origin/develop` uses that branch and falls back with a warning where it does not exist; `ref` skips a repository where the ref does not resolve and reports a warning.
- Line numbers of parsed hunks match `git diff` output on a file with three hunks.
- `git status` of every fixture repository is unchanged after reading.
