# DA-111 · Result

**Closed 2026-09-22. Done.** `tests/ci-names.test.ts` expands the check-run names out of
`.github/workflows/ci.yml` — `name:` when a job declares one, the job id otherwise, one name per
matrix cell, with `${{ matrix.<key> }}` filled from the cell — and holds them against the list in
the header comment in both directions. Both matrix forms in the file are handled: `include:`
mappings (the `smoke` job) and plain axes (`e2e`). The `windows-latest` cells are the one
declared exception, and the test reads that declaration out of the comment rather than trusting
its own copy of it.

**Checks.** `npx vitest run tests/ci-names.test.ts` — exit 0, 3 passed. Mutation probes, both
directions: renaming `name: UI suite` to `UI suite 2` → exit 1, the documented entry is named as
reporting nothing; adding `freebsd-latest` to the `e2e` matrix → exit 1, the undocumented cell is
named. Restoring the file → exit 0. A third verdict guards the guard itself: a header comment
that stopped matching the reader would make the other two vacuously true, so the list is asserted
non-empty and to contain `check`.

**The perf gate is red, and the red is not this task's.** `bun run perf` exits 1 on the base commit
too: one budget over, `Update after an edit in one repository` 336 ms against 300 ms (measured
2026-09-22 with the working changes stashed). On this tree the same run names two or three, between
371 ms and 400 ms, on a machine whose load average was 13.9–23.2 over 8 cores — above the gate's own
ceiling of 2.5 per core, which it refused on once and accepted twice. The diff carries no runtime
code at all: `CHANGELOG.md`, `tests/ci-names.test.ts`, and the task's archive directory. The spread
between runs of one tree is what DA-110 is already filed about.

**Not done here.** Branch protection on `main` is still absent — the settings endpoint answers
404, so no check is required at all (measured 2026-09-22). That is the owner's call; the test
only keeps the list honest for the day it is set.

**Docs in the same run.** `CHANGELOG.md`, `## [Unreleased]`.
