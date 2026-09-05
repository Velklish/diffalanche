# scripts

Build and fixture scripts. Unlike `src/`, code here may use `Bun.*` and other
runtime-specific APIs: scripts run under the toolchain, never inside the shipped
server or CLI. A script the Vitest suite imports is the exception — the suite
runs under Node, so `synth.ts` uses `node:` modules only.

| Script | What it does |
|---|---|
| `synth.ts` | Generates the synthetic review; see [reference/11-perf.md](../docs/reference/11-perf.md) |
