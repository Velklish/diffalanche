# DA-124 · One command for the mutation probe, declared as probe in backslop.json

- **Order:** 500
- **Scope:** all subsystems (see [reference](../../reference/README.md)); `package.json`, `backslop.json`, `scripts/`, README "Contributing"
- **Created:** 2026-10-03
- **Dependencies:** DA-119

## Context

backslop v0.20.0 reads an optional `probe` field in `backslop.json`: the command a
worker runs to prove that a check turns red when its subject is broken. Without it
`init` warns that the block carries no mutation-probe requirement and the skill asks
for a hand-made check with no command. diffalanche has no such command: every run so
far broke code by hand, and each result describes its probe in prose. The owner
decided on 2026-10-03 that diffalanche gets one, as the session bus project did.

## Work to do

- A script under `scripts/` that applies one mutation to one file, runs the command
  that should turn red, prints its exit code and the verdicts that failed, and
  restores the file whatever happens. It refuses a dirty tree and a mutation that did
  not apply. The tests run on Node and on Bun (`test`, `test:bun`); the command under
  the probe is named on the command line, with a sensible default for a test file.
- `package.json`: `"probe"` script; run as `npm run probe -- …`.
- `backslop.json`: `"probe": "npm run probe"`.
- README: how to run the probe, next to the other contributor commands.
- The script's own test: a mutation that reddens, one that does not apply, a dirty tree.

## Out of scope

- Running probes for past tasks.
- Changing any gate.

## Verification

- `init` runs without the probe warning.
- `npm run probe -- <file> …` on a known test reddens it and leaves `git status
  --porcelain` empty afterwards; a mutation that does not match exits non-zero and
  says so.
- Every gate of `backslop.json` keeps the result of the base it starts from.
