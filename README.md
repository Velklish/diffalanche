# diffalanche

A local code-review tool for a folder that holds many independent git repositories. It shows the changes of every repository under one root as a single merge-request-style review, stores review comments on disk as plain JSON, and gives coding agents a CLI to read comments, reply to them, and open their own.

**Status:** in development. Requirements are approved, the UI is designed, and the work is cut into tasks; the package builds and tests but has no product code yet.

| Document | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Product specification: base modes, on-disk format, CLI, agent protocol, performance budgets |
| [docs/design/HANDOFF.md](docs/design/HANDOFF.md) | UI design handoff: tokens, screens, interactions, keyboard map (Russian) |
| [docs/design/prototype.dc.html](docs/design/prototype.dc.html) | Working HTML prototype of every screen and state |
| [docs/README.md](docs/README.md) | Documentation index: reference, glossary, roadmap, decisions, backlog |


## Development

Bun is the toolchain; the server and the CLI run on Node >= 22 as well and use
only APIs shared by both runtimes.

```sh
bun install        # dependencies and the lockfile
bun run lint       # Biome: lint and format check
bun run typecheck  # tsc --noEmit
bun run test       # Vitest
bun run build      # bundle the CLI into dist/cli.js
```

`bun run dev` runs the CLI from source. The same lint, typecheck, and test
commands run in CI on every push and pull request. Biome skips `backslop.json`:
the backslop CLI rewrites that file in its own style, so formatting it here
would only make the two tools fight.

Layout: `src/core` (scanner, git, storage, domain), `src/cli`, `src/server`,
`src/ui`, `scripts` (build and fixture scripts), `skills` (shipped agent
skills). Only `scripts` may use runtime-specific APIs such as `Bun.*`.

License: MIT.
