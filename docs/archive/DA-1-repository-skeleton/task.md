# DA-1 · Repository skeleton: package, toolchain, layout, CI stub

- **Order:** 10
- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** none

## Context

The repository holds only documentation. Every later task needs a package to build and test in. The stack is fixed by [ADR-002](../../adr/adr-002-stack-and-delivery.md): TypeScript, Bun toolchain, server and CLI code neutral to Node and Bun, Vite + React for the UI, Biome, Vitest. Spec: `docs/SPEC.md` section 3, decision 2.

## Work to do

- `package.json` named `diffalanche` with `bin`, `engines.node >= 22`, scripts `dev`, `build`, `test`, `lint`, `typecheck`; Bun lockfile.
- `tsconfig.json` with strict mode; `src/core`, `src/cli`, `src/server`, `src/ui`, `scripts`, `skills` directories with an index file each.
- Biome config for lint and format; Vitest config; a placeholder test that runs.
- GitHub Actions workflow `ci.yml` that runs `bun install`, `bun run lint`, `bun run typecheck`, `bun run test` on push and pull request.
- Add `bun run test` and `bun run lint` to `gates` in `backslop.json`.
- `README.md`: replace the pre-implementation status with a development section (install, test, build).

## Out of scope

- Any product code, the UI shell, binaries (DA-4), the performance job (DA-5).

## Verification

- `bun install && bun run lint && bun run typecheck && bun run test` all exit 0 locally.
- The CI workflow is green on the first push.
- `npx github:Velklish/backslop#v0.3.1 lint` is green with the new gates.
