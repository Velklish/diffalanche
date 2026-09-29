# DA-45.6 · The acceptance suite runs on the Windows runner

- **Order:** 355
- **Scope:** [11-perf](../../reference/11-perf.md)
- **Created:** 2026-09-29
- **Dependencies:** none
- **Parent:** DA-45
- **Cost:** major

## Context

DA-45's card asks for "the smoke scenario and the e2e suite on a Windows runner against the Windows x64 binary". The smoke runs on all three channels since DA-45.5. The `e2e` job, which is the acceptance list of SPEC section 10 run against the binary, runs only on ubuntu and macOS.

## Work to do

- Add `windows-latest` to the `e2e` matrix under `continue-on-error`. Run its steps in Git Bash, so the summary step's quoting holds.
- Record what the cell reports in DA-45.

## Out of scope

- Fixing what it finds: each red becomes a finding of DA-45.
- Making the cell required.

## Verification

- The pull request's run has `acceptance on windows-latest`, and its outcome is quoted in DA-45.
