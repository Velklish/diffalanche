# 01 · Scanner

`src/core/scan.ts` finds the repositories of a review. What is here is the
Phase 0 spike's version, enough to feed the performance measurements; the
subsystem of `docs/SPEC.md` section 3, decision 3 — `exclude`, scanner warnings,
the `.git` file of a worktree read properly — is DA-6.

## What it does

`findRepositories(root, roots, depth)` walks each entry of `roots` relative to
the root. A directory holding `.git`, whether a directory or a file, is a
repository; it is reported by its path relative to the root, with forward
slashes, and **not** descended into. So a sibling worktree is a repository of its
own and a submodule nested inside a repository is not listed at all — the two
cases the synthetic review exists to check. The result is sorted, which makes
the review order stable between scans.

Below the repository level the walk skips directories whose name starts with a
dot, and stops at `depth` levels. A directory it cannot read is skipped
silently.

## What it does not do yet

- `exclude` patterns from the config are not applied.
- Nothing is reported about a directory that looks like a repository but cannot
  be read; DA-6 turns those into scanner warnings.
- The walk is sequential; on a root with thousands of directories that will
  matter, and DA-6 owns it.
