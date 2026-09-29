# DA-45.5 · The Windows smoke runs the bun and binary channels too

- **Order:** 355
- **Scope:** [11-perf](../../reference/11-perf.md)
- **Created:** 2026-09-29
- **Dependencies:** none
- **Parent:** DA-45
- **Cost:** major

## Context

Since DA-45.3 `smoke node on windows-latest` passes end to end, but the matrix has only the `node` channel on Windows. The `bun` channel (`bun src/cli/index.ts`) and the `binary` channel (the Bun-compiled `diffalanche-windows-x64.exe`, which the release ships) have never run on Windows. DA-45.3's review named the binary as the case its fix did not cover.

## Work to do

- Add `{ channel: bun, os: windows-latest }` and `{ channel: binary, os: windows-latest }` to the smoke matrix, under the same `continue-on-error` as the node cell.
- Record what each one reports in DA-45.

## Out of scope

- Fixing what they find: each red becomes a finding of DA-45.
- Making any Windows cell required.

## Verification

- The pull request's run has the two new cells, and their outcome is quoted in DA-45.
