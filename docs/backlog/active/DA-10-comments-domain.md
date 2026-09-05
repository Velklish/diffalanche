# DA-10 · Comments domain: anchors, roles, threads, export

- **Scope:** 04-domain (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-7, DA-8
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 3 (decisions 6, 7, 8), section 5 "Comments" and "Agent", section 7 for the shape, [ADR-004](../../adr/adr-004-agent-contract.md) for roles. A comment attaches to a line, a range, a file, a repository, or the review; a line anchor stores `lineContent`, `hunk`, `before`, `after` taken from the current diff. Only a human resolves.

## Work to do

- `src/core/domain/comments`: `addComment(input)`, `reply(id, message)`, `resolve(id, by)`, `reopen(id, by)`, `list(filter)`, `get(id)`; ids `c_` + six base36 characters, replies `r_` + counter.
- Anchor capture: given repository, path, side, line, endLine, look the lines up in the change set and store `lineContent`, the hunk header, and three lines of context on each side; a line not in the diff is refused with a message naming the nearest hunk.
- Role rules: `resolve` and `reopen` refuse any role other than `human`; `resolvedAt` and `resolvedBy` set and cleared accordingly.
- Derived state: `unanswered` (last message by a human), `awaiting` (last message by an agent), counters per file, per repository, and per review with the worst severity.
- Filters: status (`open`, `resolved`, `all`), repository, severity, unanswered.
- Markdown export grouped by repository: severity column, `path:line-endLine`, body, replies indented, as in `docs/design/HANDOFF.md` section 9.

## Out of scope

- Re-anchoring and `orphaned` (Phase 3); suggestions (Phase 2); transport (CLI and API tasks).

## Verification

- Vitest per anchor level: review, repository, file, line, range each round-trip through storage with the right nulls.
- Anchor capture on the fixture returns the exact `lineContent` and context of `git diff`.
- `resolve` with role `agent` throws a typed error and leaves the comment untouched; with role `human` sets `resolvedBy`.
- `unanswered` and `awaiting` flip after each reply in a two-message exchange.
- The export of the small fixture matches a checked-in snapshot.
