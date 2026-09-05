# scripts

Build, fixture, and verification scripts. Unlike `src/`, code here may use
`Bun.*` and other runtime-specific APIs: scripts run under the toolchain, never
inside the shipped server or CLI. A script the Vitest suite imports is the
exception — the suite runs under Node, so `synth.ts` uses `node:` modules only.

`smoke.sh` has a constraint of its own: it is POSIX shell, with no bashisms,
because it also runs in Git Bash on the Windows runner.

| Script | What it does |
|---|---|
| `build.ts` | Builds both delivery channels: `dist/cli.js` for npm and six binaries with the UI embedded, or one with `--target`; see [reference/06-cli.md](../docs/reference/06-cli.md) |
| `synth.ts` | Generates the synthetic review; see [reference/11-perf.md](../docs/reference/11-perf.md) |
| `smoke.sh` | Runs one review end to end through one delivery channel; see [reference/11-perf.md](../docs/reference/11-perf.md) |
