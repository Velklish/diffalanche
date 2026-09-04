# DA-41 · Model delivery: embedded in binaries, downloaded for npm

- **Scope:** 09-ml, 06-cli (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-33

## Context

`docs/SPEC.md` section 3, decision 10: the binary embeds the model; the npm package downloads it into a cache on first run (or per the ADR from DA-33). Everything in Phase 2 works offline once the model is present.

## Work to do

- Release pipeline: embed the model weights into the six binaries; publish the weights as a release asset with a checksum for the npm channel.
- npm channel: download on first `serve` or `suggest` into the user cache with progress output, checksum verification, and a `model pull --embedding` command to prefetch; a clear message when offline and absent.
- README section on model files, sizes, and the cache location.

## Out of scope

- The generative model (DA-46) — same mechanism, separate task.

## Verification

- The macOS arm64 binary embeds the model and `suggest` works with the network disabled; the npm package on a clean machine downloads once and then works offline; checksum mismatch aborts with a message.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 2 of `docs/SPEC.md` section 10; depends on Phase 1 artifacts (storage, server, UI).
- **Return condition:** DA-32 (Phase 1 acceptance) is archived; the cut is revisited there.
