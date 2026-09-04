# DA-31 · Release pipeline: CI matrix, binaries, npm publish

- **Order:** 310
- **Scope:** 11-perf, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-5, DA-15

## Context

`docs/SPEC.md` section 3, decision 2 and section 10: npm package and prebuilt binaries for six targets, CI green on Node and Bun, binaries built for all targets. The npm name `diffalanche` is free (checked 2026-09-05). [ADR-006](../../adr/adr-006-verification.md) lists the jobs.

## Work to do

- `ci.yml`: lint, typecheck, unit tests, smoke matrix, perf gate, e2e — all required on pull requests to `main`.
- `release.yml` on tag `v*`: build the UI, build six binaries with `bun build --compile`, attach them to a GitHub release with checksums, publish to npm with provenance from a repository secret; the version comes from the tag and is checked against `package.json`.
- `scripts/release.ts`: local preflight — clean tree, tests, version match, tag creation.
- README section "Releases" and `CHANGELOG.md` conventions.

## Out of scope

- Windows execution tests (DA-45); model assets (DA-41).

## Verification

- A pre-release tag `v0.0.1-rc.1` produces a GitHub release with six binaries and an npm publish to a `next` dist-tag; `npx diffalanche@next version` prints the version; the tag and release are kept as the first pre-release.
