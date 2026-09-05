# DA-50 · Ship agent skills for Cursor and Codex as well

- **Scope:** 10-skills (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-29

## Context

`docs/SPEC.md` section 9 ships two skills in the Agent Skills `SKILL.md` format, which Claude Code and Codex read from a skills directory. Cursor reads rules in `.cursor/rules/*.mdc` instead. Evidence that the demand exists: this repository's own backslop layout renders adapters for all three harnesses (`backslop.json`, `tools`). Whether diffalanche should render its skills the same way, or document a manual copy, is undecided.

## Work to do

- Decide after DA-29: either a `diffalanche skills install --tools claude,cursor,codex` command that renders the two skills for each harness, or a README section per harness describing a manual copy.

## Out of scope

- New skills beyond the two of DA-29; harness-specific behaviour of the CLI.

## Verification

- Hypothesis until DA-29 lands: each harness picks up the skill from its own location (Claude Code and Codex from a skills directory, Cursor from `.cursor/rules/*.mdc`).

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Depends on DA-29, which fixes the skill format and contents; the choice between a command and a README section cannot be made before the skills exist.
- **Return condition:** DA-29 is archived; revisit together with DA-30 (README pass).
