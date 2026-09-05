# DA-4 · Spike: delivery channels — binaries and npm on Node

- **Scope:** 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-1
- **Taken:** 2026-09-05

## Context

`docs/SPEC.md` section 3, decision 2 requires two channels: `npx diffalanche` on Node ≥ 22 and prebuilt binaries for macOS, Linux, and Windows on x64 and arm64. The server code must stay neutral to both runtimes ([ADR-002](../../adr/adr-002-stack-and-delivery.md)). This task proves both channels on a trivial CLI before the real one exists.

## Work to do

- A `serve --help` and `version` command in `src/cli` wired through Hono's Node adapter on Node and Bun's native server on Bun, behind one entry point.
- `bun build` of the CLI for npm (`dist/cli.js`) and `bun build --compile` for the six targets; a `scripts/build.ts` that produces all artifacts.
- Measure binary size and cold start time of `version` for each channel on the development machine; note them in the diff rendering verdict ADR from DA-3 or a section of the same ADR.
- Embedding the Vite output into the binary (`dist/ui`) so the binary serves the UI without external files.

## Out of scope

- Publishing to npm or GitHub releases (DA-31); Windows execution (DA-45).

## Verification

- `node dist/cli.js version`, `bun src/cli/index.ts version`, and `./dist/diffalanche-darwin-arm64 version` print the same version.
- The macOS arm64 binary serves the placeholder UI on `127.0.0.1:4880`.
- The build script produces six binaries without errors on macOS.
