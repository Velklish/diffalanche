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
bun run typecheck  # tsc over the three TypeScript projects
bun run test       # Vitest
bun run test:ui    # Playwright: the UI against its screenshot baselines
bun run build      # both delivery channels: dist/cli.js and six binaries
bun run build:cli  # the npm bundle alone
bun run build:ui   # build the UI into dist/ui with Vite
```

The performance harness measures the UI on the synthetic review in headless
Chromium. It needs the fixture, the built UI, and Chromium once:

```sh
bunx playwright install chromium
bun run synth -- --out .perf/fixture
bun run build:ui
bun run perf         # the gate: medians against the budgets
bun perf/run.ts      # one run, raw numbers
```

`bun run perf` is a gate: it fails when the median of any budget line of the
specification is over budget. It takes about half a minute.

`bun run test:ui` builds the UI, generates the small synthetic review
(`synth -- --out .perf/e2e --small`) and serves it: the diff and navigation
tests run against that fixture, and only the shell tests stub an empty review to
measure the shell on its own. It needs Chromium, the same one the performance
harness uses. The baselines are per platform and the ones in the repository were
taken on macOS.

`bun run typecheck` checks three TypeScript projects in one command: the runtime
code without the browser's globals, `src/ui` without Node's, and the tests and
harnesses with both.

`bun run dev` runs the CLI from source. The same lint, typecheck, and test
commands run in CI on pushes to `main` and on pull requests. Biome skips `backslop.json`:
the backslop CLI rewrites that file in its own style, so formatting it here
would only make the two tools fight.

Layout: `src/core` (scanner, git, storage, domain), `src/cli`, `src/server`,
`src/ui`, `perf` (the performance harness), `scripts` (build and fixture
scripts), `skills` (shipped agent skills). Only `scripts` and `perf` may use
runtime-specific APIs such as `Bun.*`; `src/server/runtime.ts` is the single
place in `src/` that knows which runtime it is on.

License: MIT.
