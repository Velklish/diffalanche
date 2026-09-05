# ADR-002: TypeScript on Bun, Node-neutral server, npm and binaries

**Status:** Accepted
**Revised by [ADR-008](adr-008-diff-rendering-verdict.md):** the diff library is `react-diff-view`, and the rule "no `Bun.*` outside build scripts" has one exception, `src/server/runtime.ts`.
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

The spec (section 3, decisions 2 and 12) fixes TypeScript, Bun as the toolchain, React for the UI, an existing diff-rendering library, two delivery channels, and numeric performance budgets. It leaves open the HTTP server, the UI build pipeline, the state store, and the linter. These choices shape every task in Phase 1, so they are recorded before the first line of code. Evidence: `docs/SPEC.md` sections 3, 6, 10.

## Options

- **HTTP server → Hono / bare `node:http` / Fastify.** Hono is written against the web-standard `Request`/`Response` and runs natively on Bun and on Node through `@hono/node-server`, with a built-in SSE helper. Bare `node:http` means hand-written routing and SSE and goes through Bun's compatibility layer. Fastify is Node-first.
- **UI build → Vite / Bun.build only.** Vite gives HMR, CSS modules, and font assets with a stable plugin ecosystem; Bun's HTML bundler is younger and changes between releases.
- **Diff rendering → `@git-diff-view/react` / `react-diff-view`.** The first is the spec's primary choice; the second is the fallback. Both support split and unified views and widgets between lines. The Phase 0 spike decides between them with measurements.
- **State store → zustand / Redux / React context.** The handoff asks for the prototype's single-component state to be split into a store. zustand is a few kilobytes and needs no boilerplate.
- **Linter and formatter → Biome / ESLint + Prettier.** Biome is one dependency and one config; ESLint + Prettier is two tools with overlapping rules.

## Decision

- Language: TypeScript. Toolchain: Bun for scripts, bundling of server and CLI, and `bun build --compile` for six binary targets (macOS, Linux, Windows × x64, arm64).
- Server and CLI code use only APIs shared by Node ≥ 22 and Bun; no `Bun.*` outside build scripts. The npm package runs on Node through `npx diffalanche`.
- HTTP server: Hono; on Node through `@hono/node-server`.
- UI: React built with Vite into `dist/ui`, served by the server as static files and embedded into binaries. State store: zustand.
- Diff rendering: `@git-diff-view/react`, replaced by `react-diff-view` only if the Phase 0 spike shows it misses the budgets.
- Linter and formatter: Biome. Comment ids are `c_` plus six base36 characters; reply ids are `r_` plus a counter inside the thread.
- Package layout: one package, `src/core` (scanner, git, storage, domain), `src/cli`, `src/server`, `src/ui`, `skills/`, `scripts/`.

## Consequences

- One code path for both runtimes: the smoke matrix in CI (ADR-006) runs the same commands on Node, Bun, and a binary.
- Every new dependency is checked against both runtimes before it lands.
- The diff library owns line rendering and syntax highlighting; the project writes only the framing around it (gutter, range highlight, composer and thread slots).
- Biome, zustand, and the id scheme are the owner's defaults, recorded here so a task does not reopen them; changing any of them is a new ADR.
