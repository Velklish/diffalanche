# DA-5.1 · The performance gate has never run on a GitHub runner

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-5

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
