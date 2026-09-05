# diffalanche documentation

The canonical project documentation. For current work, use `npx github:Velklish/backslop#v0.4.0 status`; for project direction, see [ROADMAP.md](ROADMAP.md); for why the system is arranged this way, see the ADRs in the table below.

| Document | Topic | Status |
|---|---|---|
| [SPEC.md](SPEC.md) | Product specification: purpose, decisions, requirements, on-disk format, CLI, agent protocol, budgets, phases | Approved, amended 2026-09-05 |
| [design/HANDOFF.md](design/HANDOFF.md) | UI design handoff: tokens, screens, interactions, keyboard map; prototype and variants next to it | Approved |
| [reference/](reference/README.md) | Subsystem reference: how the current code works | Living |
| [GLOSSARY.md](GLOSSARY.md) | Normative terminology: one concept, one name | Living |
| [ROADMAP.md](ROADMAP.md) | Direction and goals; tasks are in the backlog | Living |
| [backlog/](backlog/README.md) | Task tracker: one file per task, status is the directory, summary is `npx github:Velklish/backslop#v0.4.0 status` | Living |
| [archive/](archive/README.md) | Closed tasks: task definition and result in separate files | Living |
| [adr/adr-001-process.md](adr/adr-001-process.md) | Tasks and decisions are managed with backslop | Accepted |
| [adr/adr-002-stack-and-delivery.md](adr/adr-002-stack-and-delivery.md) | TypeScript on Bun, Node-neutral server, Hono, Vite + React, npm and binaries | Accepted |
| [adr/adr-003-on-disk-format.md](adr/adr-003-on-disk-format.md) | A directory per review session, whole-file writes under a lock, diff cache | Accepted |
| [adr/adr-004-agent-contract.md](adr/adr-004-agent-contract.md) | The CLI is the only agent contract; resolve is human-only | Accepted |
| [adr/adr-005-live-update.md](adr/adr-005-live-update.md) | File watcher, SSE stream, in-memory activity events | Accepted |
| [adr/adr-006-verification.md](adr/adr-006-verification.md) | Vitest, Node and Bun smoke matrix, Playwright performance gate | Accepted |
| [adr/adr-007-execution-model.md](adr/adr-007-execution-model.md) | Phase 0 in one session, Phase 1 by tracks with isolated review | Accepted |
| [adr/adr-008-diff-rendering-verdict.md](adr/adr-008-diff-rendering-verdict.md) | Diff rendering verdict: react-diff-view with file-card virtualisation | Accepted |
| [adr/adr-009-unit-suite-on-bun.md](adr/adr-009-unit-suite-on-bun.md) | The unit suite also runs on Bun's runtime, asserted by the suite itself | Accepted |

## Cross-cutting principles

1. **An undocumented change is incomplete.** Update the reference, subsystem README, and CHANGELOG in the same pass as the code.
2. **An accepted decision is not edited; it is superseded.** A new decision on the same question gets a new ADR; the replaced ADR retains a “superseded by ADR-NNN” note.
3. **Use only terms from the glossary.** If a required name is missing, propose it rather than silently inventing it.
4. **Evidence is stronger than intuition.** Put a number, file path, or command output in task definitions, results, and ADRs; state unverified claims as hypotheses.

Create a new ADR with `npx github:Velklish/backslop#v0.4.0 adr <slug>` **and add a row to the table above**: without the row, `npx github:Velklish/backslop#v0.4.0 lint` fails.
