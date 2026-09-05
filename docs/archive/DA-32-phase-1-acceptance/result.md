# DA-32 · Result

**Closed 2026-09-05.** Completed, with the tag made locally and not pushed: the owner's rule for this run was that nothing reaches origin, so `v0.1.0` exists in this clone and the push — which is what starts the release workflow — is the owner's step. Phase 1 as `docs/SPEC.md` section 10 lists it is on `main`: review, comments and agent requirements, the budgets, the CLI without Phase 2 and 4 commands, tests on both runtimes, the performance gate, CI, the README, the two skills.

## The acceptance criteria of section 10

Checked on the acceptance fixture root (`repos/<group>/<repo>`, the small synthetic profile plus a repository with a remote, a feature branch, a nested worktree and the generator's nested submodule) **against the built binary**, by `bun run test:e2e` — eleven named tests, 11 / 11 — and, for the lines with no UI in them, by the unit suite and the smoke matrix. Each line, with what proves it:

| Criterion | Proof |
|---|---|
| `serve` from the root lists every repository with changes; a sibling worktree is its own repository; a nested submodule or worktree is not listed | `e2e/acceptance.spec.ts`: "the tree lists the repositories with changes, and only those", "a sibling worktree is listed as a repository of its own", "a submodule or worktree nested inside a repository is not listed"; `tests/scanner.test.ts` |
| An untracked file appears in the diff; `git status` is unchanged after a scan | "an untracked file is in the diff", "git status of a repository is unchanged after a scan"; `tests/change-set.test.ts` |
| `branch` mode shows what a feature branch committed ahead of the remote default branch | "branch mode shows what a feature branch committed ahead of the remote default branch" (the committed line read from the rendered diff) |
| A comment from the UI is in `list --json` without a restart | "a comment written in the UI comes back from list --json"; `e2e/composer.spec.ts` |
| A reply from `reply` appears in the UI without a refresh | "a reply from the CLI reaches the page without a reload"; `e2e/live.spec.ts` |
| `resolve` from the UI removes the comment from `list --status open`; `resolve` from the CLI without `--role human` fails and changes nothing | "resolve in the UI takes the comment out of list --status open"; `tests/cli-comments.test.ts` "refuses anything but --role human and changes nothing"; `scripts/smoke.sh` on seven CI cells |
| A reply from `reply` shows in the activity feed with the agent's `--author` | "an agent's reply appears in the activity feed with its author" |
| `review use` switches both the UI and the CLI without `--review` | "review use switches the UI and the CLI at once" (a live `session-changed` frame, not a reload) |
| Two CLI processes replying at the same moment both land in `comments.json` | `tests/cli-comments.test.ts` "both replies land in comments.json when they are written at the same moment" |
| The performance test stays within the budget table | the table below |
| CI green on Node and Bun; binaries for six targets | locally, since nothing was pushed: `bun run test` 401, `bun run test:bun` 401, `bun run build` — `dist/cli.js` and six binaries (darwin arm64 / x64, linux arm64 / x64, windows arm64 / x64, 62–99 MiB); the workflows verified by lifting their `run:` blocks and executing them (DA-31) |

**On the owner's real workspace** (`/Users/kim.p/AtiWorkspace/workspace`, 76 repositories under `repos/` and `external/`), the built binary with `--data-dir` pointed at a scratch directory so nothing was written into the workspace: `GET /api/scan` lists 76 repositories, 19 with changes, and the sibling worktree `repos/loads_search/ati.search-LS-239863` as its own repository with the warning naming what it is a worktree of; `git status` of the workspace before and after is identical and no `.diffalanche/` appeared in it. With the default `roots: ["."]` the scan says `root is itself a repository; it is not reviewed — put it under a subdirectory or set roots`, which is decision 3 of section 3 and the right answer for a workspace whose root is a git repository: the owner's `config.json` needs `"roots": ["repos", "external"]`.

## The budget table

`bun run perf` on `main` at the end of the run, machine quiet, three repetitions each in its own process (DA-25.2):

| Metric | Budget | Median of 3 | |
|---|---|---|---|
| First render of the review after the server responds | 500 ms | 83.1 ms | ok |
| Scrolling the diff: long tasks | 0 tasks | 0 tasks | ok |
| Scrolling the diff: CPU per frame | 8.3 ms | 7 ms | ok |
| Opening the comment form | 50 ms | 26.1 ms | ok |
| Jumping to a file from the navigation | 50 ms | 10.5 ms | ok |
| Switching review sessions | 100 ms | 95.2 ms | DA-24.1 |
| Update after an edit in one repository | 300 ms | 241 ms | ok |

The session-switch line is measured over the whole wait since DA-24's review (the press, the `POST`, the re-read, the paint): 114 / 91 / 95 ms in this run, 104 warm and 513 cold on the ui-c worker's branch. It does not fail the build while DA-24.1 — the owner's choice between a server-side cache of the built document and a restated budget — is open; the line prints the task's name instead of a verdict. There is no CI summary of a release candidate to check the table against, because nothing was pushed; the `perf` job on a GitHub runner is DA-5.1, still deferred.

**The 120 Hz check was not done.** Scrolling on a 120 Hz display and recording the observed frame rate needs a person at that display; the harness's number — 7 ms of CPU per frame against an 8.3 ms frame at 120 Hz, zero long tasks over 600 frames — is what stands in for it, and the check is the owner's before the push.

## The Phase 2 cut

DA-33 to DA-41 are back in the queue in dependency order (330–410), each with a **What Phase 1 changed** section: the one runtime-specific module and ADR-009 for DA-33; the locked write path and the live-stream events for DA-34; the CLI contract guarded by `tests/readme-cli.test.ts` and the skills' `references/cli.md` for DA-35; the composer, the keyboard map's three unwired rows and the tokens pair for DA-36; the `B` toast, the route ordering, the identity-based patching and the read-only git rule for DA-37; global search's tags and preview for DA-38 and DA-39; the sessions menu, the self-write marker and `current` for DA-40; the release pipeline's six-line checksum and the `files` negation for DA-41. Nothing of Phase 2 is in `deferred/`; DA-42–50 (Phases 3 and 4) stay there with DA-5.1, DA-24.1 and DA-31.1.

## The tag

`bun run release 0.1.0` on `main`: the preflight passed (version 0.1.0 in `package.json`, a clean tree, the branch `main`, `v0.1.0` free, the `## [0.1.0] - 2026-09-05` section with the whole Phase 1 under it and an empty Unreleased above, `bun run test` green) and made the annotated tag. Not pushed. The owner's steps, in order: the branch protection rule with the check-run names spelled in `.github/workflows/ci.yml`, the `NPM_TOKEN` repository secret, `git push origin main`, `git push origin v0.1.0` — the tag push runs `release.yml`, which builds the six binaries, makes a draft release, publishes it once the assets are up, and publishes `diffalanche@0.1.0` to npm. The task's own verification — the release link — is that push.

## Findings from the walk

None filed. What the walk left for the owner, none of it a defect of Phase 1: DA-24.1 (the switch budget), DA-5.1 (the gate on a runner), DA-31.1 (a unit test flaky under load, not reproduced with the output kept), the 120 Hz check, and the release not gating on the CI result of the tagged commit (documented as deliberate in `11-perf.md`).
