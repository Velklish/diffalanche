# DA-14 · CLI comments: list, show, reply, comment, resolve, reopen, export

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-10, DA-13
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 8 rows `list`, `show`, `reply`, `comment`, `resolve`, `reopen`, `export`; section 9 for how agents use them. Defaults `--author agent`, `--role agent`; `resolve` and `reopen` require `--role human` and refuse anything else with exit code 1 ([ADR-004](../../adr/adr-004-agent-contract.md)).

## Work to do

- `list [--status open|resolved|all] [--repo] [--severity] [--unanswered] [--json]`: human-readable table and JSON including anchor text and context.
- `show <id> [--json]`: one comment with its thread and anchor.
- `reply <id> --body <text|-> [--author] [--role]`: `-` reads stdin.
- `comment --repo R [--path P] [--line N] [--end-line M] [--side new|old] --severity S --body <text|-> [--author] [--role]`: anchor filled from the current change set (`diff.json`, refreshed if older than the repository's last change).
- `resolve <id> --role human [--note] [--author]`, `reopen <id> --role human [--author]`.
- `export [--status open|all] [--format md|json]`.
- Every write goes through the storage lock so the CLI and the server interleave safely.

## Out of scope

- `suggest`, `index`, `model`, `insights` (later phases).

## Verification

- Vitest spawning the CLI on the fixture: `comment` on a line stores the right `lineContent`; `list --unanswered --json` returns it; `reply` from an agent removes it from `--unanswered`; `resolve` without `--role human` exits 1 and `list --status open` still shows it; `resolve --role human` removes it; `export` matches the domain snapshot.
- Two `reply` processes started at the same time on different comments both land in `comments.json`.
