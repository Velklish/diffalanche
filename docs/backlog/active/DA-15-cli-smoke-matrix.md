# DA-15 · CLI smoke matrix on Node, Bun, and binary

- **Scope:** 06-cli, 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-4, DA-14
- **Taken:** 2026-09-05

## Context

[ADR-006](../../adr/adr-006-verification.md): the same scenario runs under Node 22, under Bun, and against the compiled binary of the runner's platform, so a runtime difference shows up in CI rather than at a user's machine. `docs/SPEC.md` section 10: "CI is green on Node and Bun".

## Work to do

- `scripts/smoke.sh` (POSIX shell, also runnable in Git Bash): generate the small synthetic profile, `review new`, `serve` in the background, `comment`, `list --json`, `reply`, `list --unanswered --json` is empty, `resolve --role human`, `export`; stop the server; compare outputs to expectations with `jq` or a small Node script.
- A CI job matrix: `node` (22 on ubuntu, macos, windows), `bun` (latest on ubuntu, macos), `binary` (the target built in the same job).
- Failures print the command, exit code, and stderr.

## Out of scope

- Full end-to-end UI tests (DA-28); publishing (DA-31).

## Verification

- All matrix jobs are green on `main`.
- A deliberate `Bun.file` call in the CLI on a branch turns the Node jobs red; the branch is deleted afterwards.
