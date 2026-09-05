# Roadmap

Where diffalanche is going: goals and their rationale. This is a living document: a goal is direction, not a commitment; user signals determine priority and scope, not this list. Concrete tasks with statuses are in `npx github:Velklish/backslop#v0.4.0 status` and [backlog/](backlog/README.md).

## Goals

1. **Phase 0 — the stack proves the budgets.** A synthetic review of 21 repositories and 30 000 diff lines renders within the budget table of [SPEC.md](SPEC.md) section 6 on the chosen stack, in both delivery channels. If it does not, the stack changes before any MVP code. Tasks DA-1 to DA-5; decision recorded as an ADR with numbers.
2. **Phase 1 — MVP: one review over many repositories, comments on disk, a CLI for agents.** Three base modes, sessions with history, threads, live update, activity feed, keyboard map, markdown export, two agent skills, CI with a performance gate, binaries for six targets. Acceptance criteria are in SPEC.md section 10. Tasks DA-6 to DA-32.
3. **Phase 2 — suggestions and context.** Similar past comments while typing and an automatic severity proposal from a bundled embedding model; browsing any file of a repository; text and symbol search in global search. Offline. Tasks DA-33 to DA-41.
4. **Phase 3 — precision.** Comments survive code edits through re-anchoring; lost anchors become `orphaned` with a model proposal; go to definition through a configured language server; Windows verified. Tasks DA-42 to DA-45.
5. **Phase 4 — generative model.** A short note becomes a comment in the reviewer's own style; a report of recurring findings across sessions. Tasks DA-46 to DA-49.

## Prioritisation principle

Pain from the owner's real reviews decides the order inside a phase; phases are sequential because each one depends on the artifacts of the previous one (the spike's verdict, the MVP's storage and index, the embedding index for suggestions and insights). A later-phase task moves earlier only when a live review shows it is blocking.
