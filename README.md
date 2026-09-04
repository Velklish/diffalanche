# diffalanche

A local code-review tool for a folder that holds many independent git repositories. It shows the changes of every repository under one root as a single merge-request-style review, stores review comments on disk as plain JSON, and gives coding agents a CLI to read comments, reply to them, and open their own.

**Status:** pre-implementation. Requirements are approved, the UI is designed, and the work is cut into tasks. There is no runnable code yet.

| Document | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Product specification: base modes, on-disk format, CLI, agent protocol, performance budgets |
| [docs/design/HANDOFF.md](docs/design/HANDOFF.md) | UI design handoff: tokens, screens, interactions, keyboard map (Russian) |
| [docs/design/prototype.dc.html](docs/design/prototype.dc.html) | Working HTML prototype of every screen and state |
| [docs/README.md](docs/README.md) | Documentation index: reference, glossary, roadmap, decisions, backlog |

License: MIT.
