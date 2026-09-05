# DA-31.2 · Result

**Closed 2026-09-05.** Completed. The `publish to npm` step of `.github/workflows/release.yml` checks `NODE_AUTH_TOKEN` first: empty, it prints `::notice::NPM_TOKEN is not set; the npm publish is skipped, the GitHub release stands` and exits 0; set, it runs `npm publish --provenance --access public --tag <dist-tag>` as before. This is what lets the owner publish `v0.1.0` as a GitHub release with the six binaries before the npm channel is opened, with a green run.

**Verification.** The step's shell run with `NODE_AUTH_TOKEN` empty under `set -eu`: the notice, exit 0; with a value the branch is not taken. The workflow's step is otherwise unchanged from DA-31's verified form.

**Documentation in the same pass.** `README.md` (Releases), `docs/reference/11-perf.md` (The release).
