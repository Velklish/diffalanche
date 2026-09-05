# DA-41 · Model delivery: embedded in binaries, downloaded for npm

- **Order:** 410
- **Scope:** 09-ml, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-33

## Context

`docs/SPEC.md` section 3, decision 10: the binary embeds the model; the npm package downloads it into a cache on first run (or per the ADR from DA-33). Everything in Phase 2 works offline once the model is present.

## Work to do

- Release pipeline: embed the model weights into the six binaries; publish the weights as a release asset with a checksum for the npm channel.
- npm channel: download on first `serve` or `suggest` into the user cache with progress output, checksum verification, and a `model pull --embedding` command to prefetch; a clear message when offline and absent.
- README section on model files, sizes, and the cache location.

## What Phase 1 changed

Phase 1 built the release this task changes (DA-31): one job runs `bun build --compile` for the six targets, writes `SHA256SUMS.txt` and fails unless it has exactly six lines, creates the GitHub release as a draft and publishes it once the assets are up, then `npm publish --provenance`; `package.json` `files` keeps `dist/diffalanche-*` out of the tarball. The binaries are 62–99 MiB today; embedding the weights changes those numbers in [11-perf.md](../../reference/11-perf.md) and the README's "Releases" section, and a weights asset joins the checksum step's count.

## Out of scope

- The generative model (DA-46) — same mechanism, separate task.

## Verification

- The macOS arm64 binary embeds the model and `suggest` works with the network disabled; the npm package on a clean machine downloads once and then works offline; checksum mismatch aborts with a message.

