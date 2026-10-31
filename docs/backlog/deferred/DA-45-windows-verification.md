# DA-45 · Windows verification

- **Scope:** 06-cli, 03-storage, 05-watcher (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-31

## Context

`docs/SPEC.md` section 12, question 1: no Windows machine for verification; MVP binaries ship untested there. Section 10 Phase 3 lists Windows verification. Risk areas: path separators in repository ids, the `mkdir` lock and rename semantics, `fs.watch` recursion, and the git binary on PATH.

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

Second evidence, Velklish/diffalanche#8, job 109234918151, 2026-09-29. With DA-45.1's
`/dev/null`, the generator gets through, and the smoke stops at the CLI's first write:

```
smoke: review new failed
  command    node dist/cli.js review new smoke --title 'smoke scenario' --root /tmp/tmp.JAhRYxc48R/root
  exit code  1
    diffalanche: C:\Users\RUNNER~1\AppData\Local\Temp\tmp.JAhRYxc48R\root\.diffalanche\reviews\smoke: durability flush failed: EPERM
```

Assumption, not checked: it is the directory flush after an atomic write (DA-90),
and Windows refuses an `fsync` on a directory handle. The next work item is the
storage layer's flush on Windows.

Third evidence, Velklish/diffalanche#9, job 109246529382, 2026-09-29. With DA-45.3
leaving the directory flush out on Windows, `smoke node on windows-latest` passes
end to end, from `review new` through `serve`, `comment`, `reply`, `resolve` and
`export` (`smoke: node dist/cli.js passed`). Fourth evidence, Velklish/diffalanche#12, 2026-09-29: DA-45.5 adds the `bun`
channel (`bun src/cli/index.ts`, Bun `latest`) and the `binary` channel (the
Bun-compiled `diffalanche-windows-x64.exe`) to the Windows matrix, and both pass
on their first run (`smoke: ./dist/diffalanche-windows-x64.exe passed`, job
109258372320), with `check-git-null` green in each cell. Fifth evidence, Velklish/diffalanche#13, 2026-09-29: DA-45.6 adds
`windows-latest` to the `e2e` matrix. Its first run stopped at the web server:
Windows' shell read neither `rm -rf` nor `./dist/…` in `webServer.command`
(DA-45.7). Once that command became one script, `acceptance on windows-latest`
passed all 11 criteria of SPEC section 10 against `diffalanche-windows-x64.exe`
(job 109261781142, `11 passed (17.9s)`).

What is left:

- a record of the four Windows cells passing across runs;
- making them required. That is a branch protection rule on GitHub, the owner's
  setting, together with the table in 11-perf ("The checks a pull request
  requires"), `tests/ci-names.test.ts` and the `continue-on-error` in `ci.yml`,
  all in one change.

A hypothesis from DA-45.3's review, not yet seen on a runner: renaming a directory
that another process holds handles in fails on Windows. `removeSession` and the
lock's move-aside both do it, and the smoke does not exercise either against a
running server.

## Work to do

- Run the smoke scenario and the e2e suite on a Windows runner against the Windows x64 binary; fix what fails; record the platform notes in the reference.
- A Windows job in `ci.yml` required on pull requests from then on.

## Out of scope

- Windows arm64 execution (no runner available) — binaries are still built.

## Verification

- Smoke and e2e jobs are green on `windows-latest`; the reference names the platform differences found.

## Deferred

- **Deferred:** 2026-09-29
- **Reason:** The smoke on all three channels and the acceptance suite pass on `windows-latest` (DA-45.1 to DA-45.7). What is left is to make those cells required: a branch protection rule on GitHub, which is the owner's setting, together with 11-perf's table, `tests/ci-names.test.ts` and the `continue-on-error` in `ci.yml` in one change, once the cells have a record of passing.
- **Return condition:** The owner decides to require the Windows cells after they have stayed green across pull requests.

## Audit follow-up — 2026-11-01

### Context
The public installation caveat says Windows binaries have never run on Windows, contradicting the historical evidence already recorded in this task. The correction must retain the outstanding required-check, arm64 and model-verification limits.

### Evidence
`README.md:33–34` says Windows binaries build but have never been run. `docs/backlog/deferred/DA-45-windows-verification.md:43–52` records x64 binary smoke job 109258372320 and acceptance job 109261781142 with `11 passed (17.9s)`, dated 2026-09-29. `docs/reference/11-perf.md` records the three Windows smoke channels. The blanket Windows-binaries claim around `docs/reference/09-ml.md:900` also needs qualification without implying model verification.

### Scope
Correct the public installation caveats using the recorded Windows x64 CLI/UI smoke and acceptance evidence, distinguishing those historical runs from current CI readback, required branch protection, arm64 and ML support. This documentation follow-up does not authorize changing branch protection.

### Acceptance criteria
- README no longer claims that Windows binaries have never been run.
- The wording identifies the recorded architecture, channels/date and evidence without asserting current CI success.
- Windows arm64 and model verification remain explicitly unverified; the remaining DA-45 acceptance work is preserved.

### Verification
Proposed, not run: compare caveats against the dated DA-45 evidence and 11-perf; run documentation lint. External CI readback is required before a current-support badge, and was not performed for this internal contradiction check.

Verification status: current source/document hashes match manifest-final.json at 087d3330128f8762ff88b0a9f7a7151dca8db028. This is a confirmed static discrepancy, not new runtime proof. Registration rechecked local source and documentation for this finding; it did not rerun runtime or external-CI evidence.

### Related work and deduplication
Existing task: DA-45 — Windows verification. Register as an amendment to that task, not a new task. Historical job evidence is not current external verification.

Regression requirement: the implementation adds or updates a suitable quote guard, targeted assertion or existing lint rule for the corrected current claim. Show that it rejects the pre-change wording; do not infer success from link lint alone.

### Registration boundary

Audit finding PQA-305; evidence snapshot `087d3330128f8762ff88b0a9f7a7151dca8db028`. The source references were rechecked against that unchanged product snapshot on 2026-11-01. Registration is authorized; implementation and closure await separate owner approval for this item. Test commands above describe future implementation verification unless explicitly recorded as historical audit evidence.

### Next step

The owner approves this follow-up separately before implementation. Existing status and unrelated scope remain unchanged.
