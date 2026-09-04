# ADR-004: The CLI is the only agent contract; resolve is human-only

**Status:** Accepted
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

Agents read comments, reply, and open new ones; only a human closes a thread (spec section 3, decisions 8 and 9). The first draft left it open whether the CLI itself should refuse `resolve` from an agent or whether the rule in the shipped skills is enough (spec section 12, former question 1). Evidence: `docs/SPEC.md` sections 8 and 9.

## Options

- **Interface → CLI only / CLI and HTTP API.** Two contracts double the surface that has to stay compatible; the HTTP API exists for the UI and can change with it.
- **Resolve guard → in the CLI / in the skill only.** A skill is advice; an agent that skips it or a different agent that never read it can still close a thread. A check in the CLI holds regardless of who calls it.

## Decision

- The CLI is the only contract for agent skills. The HTTP API serves the UI and is not a contract; the JSON files are a second way to read the data.
- `resolve` and `reopen` require `--role human`. With the default role (`agent`) or any other value the command exits with code 1 and changes nothing. The UI passes `role: human` from `config.user`.
- CLI defaults are `--author agent` and `--role agent`. Several agents on one session sign with their own `--author` and filter by `--repo`.
- The repository ships two skills in `skills/`: `diffalanche-apply` (read unanswered comments, plan, get confirmation, edit, reply) and `diffalanche-review` (read the diff, open findings). Neither calls `resolve`.

## Consequences

- Breaking changes to CLI flags or JSON output need a new ADR and a version bump; the UI's HTTP routes can change freely.
- A human working from the terminal adds `--role human` to `resolve`; the skills never need it.
- Skill formats for other harnesses (Cursor rules, Codex) are a triage entry, not part of the contract.
