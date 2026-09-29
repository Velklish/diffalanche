# DA-45 · Windows verification

- **Order:** 830
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

- **Deferred:** 2026-09-05
- **Reason:** Phase 3 of `docs/SPEC.md` section 10; depends on Phase 1 and Phase 2 artifacts.
- **Return condition:** DA-32 (Phase 1 acceptance) is archived and the Phase 2 queue is under way; the cut is revisited there.
