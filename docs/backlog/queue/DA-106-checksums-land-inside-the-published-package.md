# DA-106 · The checksums step writes SHA256SUMS.txt into the dist/ that npm publish packs

- **Order:** 610
- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The release job builds both channels, writes a checksums manifest over the six
binaries, attaches everything to the GitHub release, and then publishes to npm —
all in one job, from one working tree, with no rebuild and no cleanup of `dist/`
in between. [.github/workflows/release.yml:90-104](../../../.github/workflows/release.yml):

```yaml
      - name: checksums
        run: |
          set -eu
          cd dist
          sha256sum diffalanche-* > SHA256SUMS.txt
```

`package.json:17-21` decides what `npm publish` packs, and its only negation
names the binaries: `"files": ["dist", "!dist/diffalanche-*", "skills"]`.
`SHA256SUMS.txt` does not match `!dist/diffalanche-*`, so it is packed.
Reproduced on npm 11.6.2 in an isolated package carrying the identical `files`
array and three placeholder files:

```
$ npm pack --dry-run --json   # files: [dist, !dist/diffalanche-*, skills]
['dist/cli.js', 'dist/SHA256SUMS.txt', 'package.json']
exit=0
```

The binary is excluded as intended; the manifest of the binaries is not. Nothing
downstream removes it: there is no `.npmignore`, `package.json` declares neither
a `prepack` nor a `prepublishOnly` script, `scripts/build.ts:136` wipes `dist/`
but runs before the checksums step rather than after it, and `.gitignore`'s
`dist/` entry governs git tracking and not what `npm pack` evaluates.

The corrected claim is the narrow one: every npm tarball of diffalanche carries
a stray six-line `SHA256SUMS.txt` listing platform binaries that the tarball
does not contain. Nothing installs wrong and nothing fails — the cost is that a
reader inspecting the installed package finds a checksums file that checksums
nothing present, and that the tarball contradicts the reason the comment at
`release.yml:138-140` gives for the `files` exclusion: the binaries "are release
assets, and the npm channel is the bundle and the UI".

It has not shipped yet in this form. `grep -rn SHA256SUMS docs/` finds the
release section of [11-perf.md](../../reference/11-perf.md) and DA-31.1's
result, and that result verified `npm pack` before the checksums step existed —
seventeen files, no stray manifest.

## Work to do

- Decide where the manifest lives. The candidates: add `"!dist/SHA256SUMS.txt"`
  to the `files` array, which is one line and keeps the workflow untouched;
  write the manifest outside `dist/` (`$RUNNER_TEMP`) and upload it from there,
  which keeps `dist/` exactly what the npm channel ships; or delete it in the
  publish step after the GitHub upload, which is the weakest because a re-run of
  the job then depends on step order. The second is the only one that makes the
  invariant structural rather than a second exclusion to keep in sync.
- Whichever is chosen, keep the two checks the step exists for: the six-line
  count at `release.yml:98-102` and the `sha256sum -c` re-read at line 103. `-c`
  resolves the paths in the manifest relative to the current directory, so a
  manifest written elsewhere still has to be verified from inside `dist/`.
- Keep the upload at `release.yml:129` pointing at wherever the file now is, and
  keep its name on the release page `SHA256SUMS.txt`: that name is what a
  downloader is told to look for.
- Update the release section of [11-perf.md](../../reference/11-perf.md) — the
  `SHA256SUMS.txt` bullet at lines 499-505 and the npm bullet at 506-513, which
  describes what the tarball contains — in the same pass.
- Add a check that the tarball's contents stay what they are meant to be. A
  `npm pack --dry-run --json` assertion over the file list, run in CI, is the
  cheapest form; where it runs is part of the decision, since the release job
  itself is the wrong place for a check whose failure should stop a merge and
  not a tag.

## Out of scope

- The binaries themselves, their size, and the choice to publish them as release
  assets rather than in the tarball; that split is decided and documented.
- The provenance attestation and the `NPM_TOKEN`-missing path, which are
  correct as they are.
- Whether the release job should build again between the GitHub upload and the
  npm publish. A second build of half a gigabyte to clean one text file is not
  the fix, and this entry does not propose it.

## Verification

- `npm pack --dry-run --json` over a tree whose `dist/` contains a
  `SHA256SUMS.txt` lists no such entry, and still lists `dist/cli.js` and the
  UI bundle while still excluding `dist/diffalanche-*`.
- The mutation probe: put the manifest back into `dist/` and the new check goes
  red. A check that passes either way is not a check.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  `bun run perf` is untouched — this changes packaging, not the measured paths.
