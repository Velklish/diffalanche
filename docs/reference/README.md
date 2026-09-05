# Reference

How diffalanche works today — from the code, not intention. Intent and rationale are in [ADRs](../README.md); this reference describes only the behaviour of the running version. It is organised by subsystem so each file can be edited independently. The “Scope” field of tasks links here.

The table names the subsystems the task cut expects; each section file is written by the task that creates the subsystem (see DA-30 for the pass that fills them in). A section that links to a file has been written; the rest do not exist yet.

| Section | About | Planned path |
|---|---|---|
| [01-scanner.md](01-scanner.md) | Finding repositories under the root: roots, depth, exclude, worktrees, warnings | `src/core/scanner` |
| [02-git.md](02-git.md) | Reading the change set: base modes, merge base, untracked files, patch parsing | `src/core/git` |
| 03-storage.md | Data directory, session directories, locking, atomic writes, schema version | `src/core/storage` |
| 04-domain.md | Sessions, comments, anchors, roles, unanswered and awaiting, export | `src/core/domain` |
| 05-watcher.md | Watching repositories and the data directory, incremental rescans, activity events | `src/core/watcher` |
| [06-cli.md](06-cli.md) | Commands, flags, exit codes, JSON output | `src/cli` |
| [07-server.md](07-server.md) | HTTP routes, the review bundle, SSE stream, static UI | `src/server` |
| [08-ui.md](08-ui.md) | Screens, store, keyboard map, live patching | `src/ui` |
| 09-ml.md | Embedding model, index, suggestions, generative model (Phase 2 and later) | `src/core/ml` |
| 10-skills.md | Shipped agent skills and the reply protocol | `skills/` |
| [11-perf.md](11-perf.md) | Synthetic review generator and the performance gate | `scripts/`, `perf/` |
