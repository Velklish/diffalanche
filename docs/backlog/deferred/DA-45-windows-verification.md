# DA-45 · Windows verification

- **Scope:** 06-cli, 03-storage, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-31

## Context

`docs/SPEC.md` section 12, question 2: no Windows machine for verification; MVP binaries ship untested there. Section 10 Phase 3 lists Windows verification. Risk areas: path separators in repository ids, the `mkdir` lock and rename semantics, `fs.watch` recursion, and the git binary on PATH.

## First evidence from a Windows runner

`ci` run 33983377225 on `main` at `b490494`, 2026-09-05, cell
`smoke node on windows-latest` (`continue-on-error`): the smoke script never
reaches the CLI — the synthetic generator fails while making its fixture:

```
synth: Command failed: git -C C:\Users\RUNNER~1\AppData\Local\Temp\tmp.40Z6BiJF5A\root\sources\vendor-lib -c init.defaultBranch=main -c user.name=synth …
error: script "synth" exited with code 1
```

The root is a `mktemp -d` path under the runner's temp directory, spelled the
Windows way (`RUNNER~1`); `scripts/synth.ts` runs `git -C <path>` on it. The
first work item is the generator on Windows, before anything in the CLI.

## Work to do

- Run the smoke scenario and the e2e suite on a Windows runner against the Windows x64 binary; fix what fails; record the platform notes in the reference.
- A Windows job in `ci.yml` required on pull requests from then on.

## Out of scope

- Windows arm64 execution (no runner available) — binaries are still built.

## Verification

- Smoke and e2e jobs are green on `windows-latest`; the reference names the platform differences found.

## Deferred

- **Deferred:** 2026-09-05
- **Reason:** Phase 3 of `docs/SPEC.md` section 10; depends on Phase 1 and Phase 2 artifacts.
- **Return condition:** DA-32 (Phase 1 acceptance) is archived and the Phase 2 queue is under way; the cut is revisited there.
