# DA-50 · Ship agent skills for Cursor and Codex as well

- **Scope:** 10-skills (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-29

## Context

`docs/SPEC.md` section 9 ships two skills in the Agent Skills `SKILL.md` format, which Claude Code and Codex read from a skills directory. Cursor reads rules in `.cursor/rules/*.mdc` instead. Evidence that the demand exists: this repository's own backslop layout renders adapters for all three harnesses (`backslop.json`, `tools`). Whether diffalanche should render its skills the same way, or document a manual copy, is undecided.

## Work to do

- [TODO: decide after DA-29 — a `diffalanche skills install --tools claude,cursor,codex` command, or a README section per harness.]

## Out of scope

- [TODO]

## Verification

- [TODO]
