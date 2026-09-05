# DA-2 · Synthetic review generator for tests and the performance gate

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-1
- **Taken:** 2026-09-05

## Context

The performance budgets in `docs/SPEC.md` section 6 are measured on a synthetic review: 21 repositories, 300 files, 30 000 diff lines, 200 comments. The spike (DA-3), the gate (DA-5), and scanner and storage tests all need the same fixture, generated deterministically so numbers are comparable between runs.

## Work to do

- `scripts/synth.ts`: creates a root with `repos/<group>/<repo>` layout, initialises each repository with `git init`, commits a base state, then applies working-tree edits and untracked files so that the total diff is 30 000 lines across 300 files in 21 repositories. Seeded pseudo-random content in several languages (TypeScript, C#, Python, Go, Markdown) with realistic line lengths.
- Writes a `.diffalanche/` data directory with one session and 200 comments over the generated lines, using the on-disk format of `docs/SPEC.md` section 7 (`review.json`, `comments.json`; `diff.json` is left to the scanner).
- Options: output directory, seed, and a small profile (3 repositories, 20 files) for unit tests.
- A worktree checked out as a sibling directory and a nested submodule inside one repository, so scanner tests can use the same fixture.

## Out of scope

- Measuring anything; the diff JSON cache; the UI.

## Verification

- Running the generator twice with the same seed produces byte-identical trees except `.git` metadata timestamps.
- `git diff --stat` over all repositories sums to 300 files and 30 000 changed lines (±1 %), printed by the script at the end.
- A Vitest test runs the small profile in a temporary directory and checks the counts.
