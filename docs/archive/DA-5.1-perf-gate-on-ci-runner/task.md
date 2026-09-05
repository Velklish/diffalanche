# DA-5.1 · The performance gate has never run on a GitHub runner

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-5
- **Taken:** 2026-09-05

## Context

Finding from DA-5. Every number of the budget table was measured on the
development machine — MacBook Pro 18,3, Apple M1 Pro, 8 cores — and the run that
matters for the build is the `perf` job of `.github/workflows/ci.yml` on a
GitHub-hosted `ubuntu-latest` runner, which nothing in this phase could execute:
the branch is local and nothing was pushed.

Two lines have little headroom on a slower machine. CPU per frame measures 6.4 ms
against a ceiling of 8.3 ms — a runner half as fast fails it, and the failure
would say "regression" while nothing regressed. Long tasks must be exactly zero,
and a busy shared runner can produce one from a garbage collection alone. First
render (31 ms against 500 ms), the composer (15 ms against 50 ms), and the file
jump (7 ms against 50 ms) have an order of magnitude of headroom and are not the
worry.

Evidence: `bun run perf` on the development machine, medians of three runs —
`| Scrolling the diff: CPU per frame | 8.3 ms | 6.9 ms | ok |`; `perf/budgets.ts`
holds the ceiling; `.github/workflows/ci.yml` job `perf` is unexecuted.

The same gate, the same commit, the same machine under a load average of about
13 on eight cores: `| Scrolling the diff: CPU per frame | 8.3 ms | 9.4 ms |
FAIL |`, with eight and ten long tasks in two of the three runs. So this is not
a hypothesis about a slow runner — a machine that is merely busy already turns
the gate red, and a shared CI runner is busy by construction.

## The first run on a GitHub runner

`ci` run 33983377225 on `main` at `b490494`, 2026-09-05, `ubuntu-latest`, the
gate as it is after DA-25.2 (one process per repetition), against the
development machine's quiet run of the same commit:

| Metric | Budget | Runner, median of 3 | Runner runs | M1 Pro |
|---|---|---|---|---|
| First render | 500 ms | 160.7 ms | 165 / 161 / 156 | 86.6 ms |
| Scrolling: long tasks | 0 | 0 | 0 / 0 / 0 | 0 |
| Scrolling: CPU per frame | 8.3 ms | **17.3 ms — FAIL** | 18.2 / 16.7 / 17.3 | 7.8 ms |
| Opening the comment form | 50 ms | **50.5 ms — FAIL** | 58.3 / 50.5 / 49.6 | 22.6 ms |
| Jumping to a file | 50 ms | 20.8 ms | 20.8 / 23.8 / 18.8 | 11.1 ms |
| Switching review sessions | 100 ms | 180.5 ms (DA-24.1) | 438 / 181 / 180 | 107.8 ms |
| Update after an edit | 300 ms | 249 ms | — | 273 ms |

The runner is a little over twice as slow on the CPU line and holds zero long
tasks; the composer sits on the budget's edge. One run of the three the return
condition asks for.

## Work to do

- Run the `perf` job on a GitHub-hosted runner and record the medians it
  produces next to the numbers of the development machine.
- Decide what the gate does about the difference, and record the decision where
  the budget lives: hold the specification's numbers everywhere; or give the
  runner a named allowance in `perf/budgets.ts`, with the multiplier and its
  reason in the file; or move the job to a machine that can hold them.
- If an allowance is chosen, the local run keeps the strict numbers: a budget
  that only CI enforces stops being a budget developers meet.

## Out of scope

- Changing what is measured or how (`perf/harness.ts`), and the 120 fps check by
  hand, which stays a phase checkpoint.

## Verification

- The `perf` job is green on `main` for three consecutive runs, or the ceiling
  that was changed is in `perf/budgets.ts` with the runner numbers beside it.
- `docs/reference/11-perf.md` says which numbers the gate enforces where.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** The `perf` job cannot run on a GitHub-hosted runner in this run (nothing is pushed), so the runner medians the decision needs do not exist. The local evidence is recorded: the same commit fails CPU per frame (9.4 ms) and shows 8–10 long tasks when the development machine is busy (load average about 13 on eight cores) and passes (6.9 ms, 0 tasks) when it is quiet. Until the runner numbers exist the gate keeps the specification's numbers everywhere, and a local run is repeated on a quiet machine before it is read as a regression.
- **Return condition:** The first push to GitHub; the `perf` job has run at least three times on `main`, and its medians are recorded next to the development-machine numbers. The owner then picks one of the three outcomes in “Work to do”.
