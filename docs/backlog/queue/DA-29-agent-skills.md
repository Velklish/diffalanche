# DA-29 · Agent skills: diffalanche-apply and diffalanche-review

- **Order:** 290
- **Scope:** 10-skills (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-14

## Context

`docs/SPEC.md` section 9: two skills following the pattern of difit and diffity. `diffalanche-apply` runs `list --unanswered --json`, groups by repository, presents a plan, gets the human's confirmation, edits `<root>/<repo>/<path>`, and replies to every comment; `diffalanche-review` reads `diff --json` and opens findings with `comment`. Reply rules: one or two sentences when fixed, full reasoning when declined; several agents filter by `--repo` and sign with `--author`. Neither calls `resolve` ([ADR-004](../../adr/adr-004-agent-contract.md)).

## Work to do

- `skills/diffalanche-apply/SKILL.md` and `skills/diffalanche-review/SKILL.md` in the Agent Skills format (frontmatter `name`, `description` with triggers, body with the procedure); a `references/` file each with command examples and JSON shapes.
- The procedure names the exact commands and flags, the confirmation gate before edits, the reply rules, and the multi-agent conventions.
- A section in `README.md` on installing the skills into Claude Code (`.claude/skills/`) and pointing other harnesses at the files.

## Out of scope

- Cursor and Codex adapters (DA-50, triage).

## Verification

- A Claude Code session with the skill installed, run on the fixture with three unanswered comments in two repositories, presents the grouped plan, edits after confirmation, and replies to all three; `list --unanswered --json` is empty afterwards and no comment is resolved. The run transcript is attached to `result.md`.
- `diffalanche-review` on a fixture diff opens at least one comment with a line anchor.
