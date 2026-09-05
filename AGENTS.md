# diffalanche — agent guide

diffalanche is a local code-review tool for a folder that holds many independent git repositories: one merge-request-style review across all of them, comments as JSON on disk, a CLI for coding agents. Requirements are in [docs/SPEC.md](docs/SPEC.md); the UI design is in [docs/design/HANDOFF.md](docs/design/HANDOFF.md) with a working prototype next to it. Read the spec section that your task names before touching code.

Rules for every change:

- **The tool never writes to a reviewed repository.** No commits, index changes, resets, or file edits; git is read through the `git` binary only. The only writable location is the data directory.
- **Server and CLI code use only APIs shared by Node and Bun.** Runtime-specific calls (`Bun.*`, Node-only modules without a Bun counterpart) are not allowed outside build scripts and `src/server/runtime.ts` — the single module that chooses between Bun's server and the Node adapter ([ADR-008](docs/adr/adr-008-diff-rendering-verdict.md)). A second such module is a new decision, not a convenience.
- **The UI follows the handoff, not the prototype line by line.** Tokens, layout, and behaviour come from `docs/design/HANDOFF.md`; the diff itself is rendered by the chosen library, and the prototype's hand-drawn diff is only a layout reference.
- **Performance budgets are a gate.** Section 6 of the spec is checked in CI on the synthetic review; a change that regresses it is not done.

<!-- backslop:start -->
## Tasks and decisions — backslop

The task tracker and decision log live in `docs/` and are managed with `npx github:Velklish/backslop#v0.3.1` (configuration: `backslop.json`, task prefix: `DA`). There is no task list in files: `npx github:Velklish/backslop#v0.3.1 status` prints the queue, active work, deferred work, and triage. The operating rules are in `docs/backlog/README.md`; terms are in `docs/GLOSSARY.md`. The layout version is the `version` field in `backslop.json`; update backslop with `npx github:Velklish/backslop#v0.3.1 upgrade` when you decide to, not because of someone else's commit.

**Skills (when an adapter is selected):** `backslop-task` — the lifecycle of one task; `backslop-batch` — a worker run by tracks; `backslop-seed` — populate documentation after installation.

**Change procedure.** There are two roles: the worker implements and verifies (steps 1–4), the approver accepts and closes (5–7); a single agent performs both roles in order.

1. **Task.** Take the first queued task (`npx github:Velklish/backslop#v0.3.1 status`) or create one: `npx github:Velklish/backslop#v0.3.1 new <slug> --title "…"` puts it in triage; `--queue` puts it directly in the queue. A small change without a tracker record is allowed if one pass fully implements it and it does not change a contract. A finding this pass will not close becomes a file immediately: `npx github:Velklish/backslop#v0.3.1 new <slug> --parent N`, with evidence.
2. **Change.** Reverse a previous decision by clean removal, without strikethroughs or “cancelled” notes. Preserve the style of the existing file. Use terms from the glossary; if a required term is missing, propose it rather than silently inventing it.
3. **Documentation in the same pass.** An undocumented change is incomplete: update the relevant `docs/reference/` section, the affected subsystem README, and CHANGELOG. An architectural decision needs `npx github:Velklish/backslop#v0.3.1 adr <slug>` and a row in `docs/README.md`.
4. **Gates before reporting.** The commands in `gates` in `backslop.json` must be green. Verify a test change with a mutation probe: commit first, then run the probe.
5. **Acceptance and archive** are one approver pass: review the diff, run `npx github:Velklish/backslop#v0.3.1 archive N`, complete `result.md` (outcome, what was done, verification), and ensure `npx github:Velklish/backslop#v0.3.1 lint` is green. A worker does not declare their work accepted or move task files between directories.
6. **Triage review** follows closure immediately: every entry gets a next step — merge, clarify, `npx github:Velklish/backslop#v0.3.1 mv N queue`, or `npx github:Velklish/backslop#v0.3.1 mv N deferred` with a return condition. Ask the owner only before rejecting an entry.
7. **Commit.** Start the message with the task number: `DA-N: <what was done>`. A task reaches the main branch as one commit: taking it, review fixes, and acceptance are squashed before pushing.

Worker boundaries: change only the assigned branch or worktree; do not touch status directories or `docs/archive/`; closure and triage belong to the approver.
<!-- backslop:end -->
