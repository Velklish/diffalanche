# scripts

Build, fixture, and verification scripts. Unlike `src/`, code here may use
`Bun.*` and other runtime-specific APIs: scripts run under the toolchain, never
inside the shipped server or CLI. A script the Vitest suite imports is the
exception — the suite runs under Node, so `synth.ts` uses `node:` modules only.

`smoke.sh` has a constraint of its own: it is POSIX shell, with no bashisms,
because it also runs in Git Bash on the Windows runner.

| Script | What it does |
|---|---|
| `build.ts` | Builds both delivery channels: the npm bundle and six binaries with the UI, the model and its runtime embedded, or one with `--target`; see [reference/06-cli.md](../docs/reference/06-cli.md) |
| `bundle.ts` | The npm bundle, `dist/cli.js` and `dist/embed-worker.js`, with the runtime's binding loaded from the user cache (`bun run build:cli`); see [reference/09-ml.md](../docs/reference/09-ml.md#delivery) |
| `assets.ts` | Stages the model and every platform's runtime files under their release names, checked against their pins; see [reference/09-ml.md](../docs/reference/09-ml.md#delivery) |
| `synth.ts` | Generates the synthetic review; see [reference/11-perf.md](../docs/reference/11-perf.md) |
| `smoke.sh` | Runs one review end to end through one delivery channel; see [reference/11-perf.md](../docs/reference/11-perf.md) |
| `release.ts` | The local preflight of a release and the annotated tag; never pushes. See [reference/11-perf.md](../docs/reference/11-perf.md) |
