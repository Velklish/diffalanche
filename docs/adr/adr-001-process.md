# ADR-001: Tasks and decisions are managed with backslop

**Status:** Accepted
**Date:** 2026-09-04
**Deciders:** Velklish

## Context

The project needs a task tracker and decision log that live alongside code, can be read by an agent without external services, and do not conflict when branches are worked on in parallel. A task list in one file conflicts on every closure; decisions scattered across chats cannot be found when needed.

## Decision

Tasks and decisions are managed with backslop:

- a task is a `DA-<number>-<slug>.md` file; its status is the `docs/backlog/{triage,queue,active,deferred}/` directory; closed tasks live in `docs/archive/<id>-<slug>/` with `task.md` and `result.md` until they are folded into `docs/archive/LOG.md`;
- queue priority is the “Order” field in the file; `npx --no-install backslop new` assigns numbers across directories, while findings get `N.k` without coordination;
- decisions are ADRs in `docs/adr/` linked from `docs/README.md`; a changed decision is rewritten in place;
- the change procedure is in the backslop section of `AGENTS.md`, roles are in `docs/ROLES.md`, and the tracker and archive formats are in their READMEs;
- gates are listed in `backslop.json`, including `npx --no-install backslop lint`;
- the tool version is pinned in `package.json` and `bun.lock`; `backslop.json` names the local CLI and records the layout `version`. Update with `npx --no-install backslop upgrade`, while `migrate` changes file formats between versions.

## Consequences

- Changing status is a `git mv` of one file: two branches conflict only on the same task.
- There is no task list in git — `npx --no-install backslop status` provides the summary; opening the backlog README to see the queue is pointless.
- The cost is discipline: `lint` maintains links, numbers, and fields, but authors maintain the substance of task definitions and results.
