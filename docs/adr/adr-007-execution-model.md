# ADR-007: Phase 0 in one session, Phase 1 by tracks with isolated review

**Status:** Accepted
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

The work is cut into 49 tasks across four phases (see `docs/backlog/`). The owner reviews work produced by coding agents and needs a rule for who does what and how a change is accepted before the first task starts. The spec's Phase 0 is a spike that decides the stack against the budgets; its outcome shapes every UI task. Evidence: `docs/SPEC.md` section 10, `docs/backlog/README.md`.

## Options

- **Phase 0 → one session / parallel workers.** The spike, the package skeleton, and the CI stub touch the same files; parallel workers would conflict on every commit.
- **Phase 1 → one agent task by task / `backslop-batch` by tracks.** The MVP splits into tracks with few shared files: core, cli, server, ui, docs. Tracks run in parallel with one worker each and a brief per track; a single agent would take five times longer.
- **Review → the worker's own subagent / an isolated read-only session.** A reviewer with the worker's context repeats the worker's blind spots.

## Decision

- Phase 0 (DA-1 to DA-5) is done by one Claude Code session, task by task, following `backslop-task`. The spike code stays in the repository as the skeleton for Phase 1.
- Phase 1 runs through `backslop-batch`: one track per subsystem (core, cli, server, ui, docs), each with a self-contained brief and a worker session in its own branch or worktree. Workers do not move task files; findings become `new --parent N` entries.
- Every track's diff is reviewed by an isolated read-only session with fresh context before acceptance. The approver squashes a task into one commit `DA-N: …` on `main`.
- Phase 2 to 4 tasks stay in `deferred/` until DA-32 (Phase 1 acceptance) is archived; their cut is revisited then.

## Consequences

- Track briefs name the spec sections, the handoff sections, and the ADRs a worker must read; the worker reads nothing else of the backlog.
- Contract changes between tracks (CLI flags, JSON shapes, HTTP routes) are settled in `src/core` types first and named in the briefs.
- The queue order in `docs/backlog/queue/` is the order inside a track; tracks themselves run in parallel.
