# DA-111 · The check-run names branch protection must list live in a comment, and nothing compares them with the jobs that report them

- **Order:** 470
- **Area:** CI, `.github/workflows/ci.yml`, `tests/`
- **Created:** 2026-09-22
- **Depends on:** none

## Context

Branch protection matches **check-run names**, not job ids, and the names are spelled out in a
comment at the top of `.github/workflows/ci.yml` — twelve of them, with three `<- the job id
is …` notes where a `name:` renames the job. The comment is the only place the list exists.

Rename a job, drop a matrix cell or add an axis, and the comment keeps promising a name no run
reports. The failure is quiet in the worst possible place: a required check that never reports
leaves every pull request at "Expected — waiting for status to be reported", so the branch is
not protected, it is blocked — and the file that caused it stays green under `lint`, `test` and
`typecheck`, none of which read a workflow.

The repository already reads a workflow as text in a test (`tests/package.test.ts` asserts on
`release.yml`), so the shape of the check is established; what is missing is the comparison.

## What to do

- `tests/ci-names.test.ts`: expand the real check-run names out of `ci.yml` — a job reports
  under its `name:` when it has one and under its id otherwise, a matrix job reports one check
  per cell, and `${{ matrix.<key> }}` in a name is filled from the cell — and assert that every
  name the header comment lists is among them.
- Assert the other direction too, with the one exception the comment itself declares:
  `windows-latest` cells are deliberately not required until DA-45 has run them.

## Not in scope

- Setting branch protection on `main`. There is none today (the settings endpoint answers 404,
  measured 2026-09-22): no checks are required at all, and that is the owner's call, not a
  test's.
- A YAML parser dependency. The workflow is read as text, the way `package.test.ts` reads
  `release.yml`.

## Checks

- `bun run test` — green, with the new verdicts in it.
- Mutation probe: rename `name: UI suite` to `name: UI suite 2` → the test fails and names the
  documented entry that no longer reports; restore → green.
- Second probe, the other direction: add a matrix cell → the test names it as reporting a check
  the comment does not list.
