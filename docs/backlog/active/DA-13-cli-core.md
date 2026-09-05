# DA-13 · CLI core: serve, review, diff

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-9, DA-11
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 8: every command accepts `--review` (default: the current session) and `--data-dir`; `serve [--root] [--port] [--open]`, `review new <name> [--base …] [--title]`, `review use`, `review list [--json]`, `review base`, `diff [--repo] [--json|--patch]`. The CLI is the agent contract ([ADR-004](../../adr/adr-004-agent-contract.md)).

## Work to do

- `src/cli`: argument parsing with `util.parseArgs` (available in Node 22 and Bun), one module per command, a shared context (root, data directory, config, session).
- `serve` starts the server (DA-16) and prints the URL; `--open` opens the browser.
- `review new`, `use`, `list`, `base` over the domain (DA-9); `list --json` prints the session records.
- `diff`: runs a scan, writes `diff.json`, prints the change set as JSON or as a unified patch; `--repo` filters; without a server it is the way an agent reads the review.
- Exit codes: 0 success, 1 user error with a one-line message, 2 unexpected error with a stack trace. Errors go to stderr; JSON goes to stdout unmixed.
- `--help` for every command generated from the same definitions.

## Out of scope

- Comment commands (DA-14); the server itself (DA-16).

## Verification

- Vitest spawning the built CLI on the small fixture: `review new a --base branch:origin/main` creates the session and sets `current`; `review list --json` lists it; `diff --json` prints repositories with changes and writes `diff.json`; a wrong `--base` value exits 1 with a message.
- `diffalanche --help` lists every command of section 8 that exists at this point.
