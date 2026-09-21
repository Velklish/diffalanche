# DA-112 · What section 5 of the spec may contain is practice, not a rule, and the practice is one edit away from drifting

- **Order:** 471
- **Area:** `docs/SPEC.md`, `AGENTS.md`
- **Created:** 2026-09-22
- **Depends on:** none

## Context

Section 5 of the spec holds functional requirements, and today it holds nothing else: 51 lines,
eight backticked tokens, and every one of them a contract — the `--review` flag and the four
comment states `current`, `orphaned`, `unanswered`, `warning` (measured 2026-09-22). No component
name, no module path, no internal mechanism.

That is a practice nobody wrote down. The spec is the document a task names before touching code,
and once a component name lands in it the reader can no longer tell which lines are requirements
the tool owes its user and which are a description of how today's build happens to work — the
second kind goes stale on the next refactor while reading exactly like the first.

## What to do

- Add the rule to `AGENTS.md`, under the rules for every change: the spec states what the user
  and the agent can do, plus contracts — on-disk format, CLI, budgets as numbers. Components and
  internal mechanisms belong to the reference sections and to ADRs.

## Not in scope

A test. The natural shape — "no component names in section 5" — has nothing to key on: the
section's only identifiers are contract values, so a regex over paths or module names is green on
today's text and on any text that keeps prose about internals free of backticks. A check that
cannot fail on the thing it is named after is worse than no check, because it reports coverage.

## Checks

- `npx github:Velklish/backslop#v0.9.0 lint` — exit 0.
- The claim in the context is reproducible: `awk 'NR>=64 && NR<=114' docs/SPEC.md | grep -o '`[^`]*`' | sort -u`
  prints five distinct tokens, eight occurrences, all contract values.
