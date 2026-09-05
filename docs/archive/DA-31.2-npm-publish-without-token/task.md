# DA-31.2 · The npm publish step stops green without NPM_TOKEN

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-31
- **Taken:** 2026-09-05

## Context

The owner's decision at the Phase 1 acceptance (DA-32): the first release is a
tag on GitHub without the npm channel — the `NPM_TOKEN` secret is not set yet.
As written, `release.yml` would create and publish the GitHub release and then
fail at `npm publish` with no token, leaving a red run on a release that is
complete for what was asked of it.

## Work to do

- `.github/workflows/release.yml`, the `publish to npm` step: when
  `NODE_AUTH_TOKEN` is empty, say so in a `::notice::` and exit 0; the GitHub
  release is then the whole release.
- README "Releases" and `docs/reference/11-perf.md` "The release" say what the
  step does without the secret.

## Out of scope

- Publishing to npm: the secret and the first `npm publish` are the owner's.

## Verification

- The step's shell lifted out of the YAML and run with `NODE_AUTH_TOKEN` empty
  exits 0 with the notice; with a value it reaches `npm publish`.
