# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Package skeleton: `package.json`, strict `tsconfig.json`, Biome, Vitest, the
  `src/core`, `src/cli`, `src/server`, `src/ui`, `scripts`, and `skills`
  directories, and a GitHub Actions workflow running lint, typecheck, and tests.
- `scripts/synth.ts`, the generator of the synthetic review: 21 repositories,
  300 files, 30 000 changed lines, and 200 comments, deterministic for a given
  seed, with a small profile for unit tests. Run it with
  `bun run synth -- --out <dir>`; it refuses an output directory it did not
  write itself, because it erases that directory before filling it.
- Phase 0 spike of the diff rendering: `src/core` reads the change set of every
  repository through the `git` binary, `src/server` serves it as one response on
  Hono, `src/ui` renders it with a diff library in split view, and `perf/`
  measures the page in headless Chromium. `react-diff-view` with virtualisation
  by file card meets the budgets of the specification; see
  [ADR-008](docs/adr/adr-008-diff-rendering-verdict.md).
- Both delivery channels on a CLI with `version`, `serve`, and `--help`:
  `bun run build` produces `dist/cli.js` for npm and six binaries — macOS,
  Linux, and Windows on x64 and arm64 — each carrying the UI inside itself. The
  runtime switch between Bun's server and `@hono/node-server` is the only place
  in `src/` that knows which runtime it runs on.
- Performance gate: `bun run perf` measures the page on the synthetic review
  three times in headless Chromium and fails when the median of any line of the
  budget table is over budget. It runs in CI as the `perf` job, prints the table
  into the run summary, and is one of the `gates` of `backslop.json`. The two
  budget lines Phase 0 cannot measure — switching sessions and updating after an
  edit — are printed as pending until DA-9 and DA-25.
