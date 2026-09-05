# 11 · Synthetic review generator, the performance gate, the smoke matrix, the runtime of the unit suite, and the release

`scripts/synth.ts` builds the synthetic review: the fixture the performance
gate, the diff rendering spike, and the scanner and storage tests all measure
against. `perf/` measures the UI on it.

## Running it

```sh
bun run synth -- --out <dir> [--seed <n>] [--small]
```

| Option | Meaning |
|---|---|
| `--out <dir>` | Root of the generated review. Required; the directory is emptied first, and refused if it holds anything other than an earlier run |
| `--seed <n>` | Seed for every random choice. Default `1` |
| `--small` | The small profile instead of the full one |

The script prints the totals it measured and exits. It erases `--out` before
filling it, so it refuses a directory that exists, is not empty, and has no
`.diffalanche/` from an earlier run: without that check `--out .` in a checkout
would take the working tree and its `.git` with it. Failure is one line on
stderr and exit code 1.

## Profiles

| Profile | Repositories with changes | Files | Changed lines | Comments |
|---|---|---|---|---|
| full (default) | 21 | 300 | 30 000 | 200 |
| `--small` | 3 | 20 | 2 000 | 20 |

The full profile is the synthetic review of `docs/SPEC.md` section 6. The small
one exists so a unit test can run the same code path in a second.

**The file and line counts are the change set, not `git diff`.** The change set
is what the spec means by a diff (section 3, decision 4): tracked edits plus
untracked files. `git diff` never reports an untracked file — only
`git add --intent-to-add` would put one there, and that writes to a repository's
index, which the tool must never do. So the generator's totals are the sum of
the two, and it prints all three numbers:

```
synthetic review at /tmp/synth
    21 repositories with changes; a scan finds 22, the extra one
       being the clean sibling worktree
  git diff         279 files   27894 lines
  untracked         21 files    2106 lines
  change set       300 files   30000 lines
   200 comments in reviews/synth/comments.json
```

A changed line is an insertion or a deletion, counted as `git diff --numstat`
counts them. The change set totals are exact, not approximate.

## What it produces

```
<out>/
  repos/<group>/<repo>/          21 repositories, each a git working tree
  repos/core/cargos-api-worktree/   a worktree of the first repository, checked out clean
  repos/core/cargos-api/vendor/lib/ a submodule nested inside the first repository
  sources/vendor-lib/            the submodule's source, outside repos/ so a scan never sees it
  .diffalanche/                  the data directory
```

Every repository is a `git init` with one base commit, then working-tree edits
on top: one file per repository is left untracked, the rest are committed and
then rewritten in place, one block replaced per file. Generated content is
TypeScript, C#, Python, Go, and Markdown in equal rotation, in whole functions,
classes, and sections rather than loose lines.

The two extra entries exist for the scanner (`docs/SPEC.md` section 10): the
sibling worktree must be listed as a repository of its own, the nested submodule
must not be listed at all. The worktree carries no changes, so the review shows
21 repositories while a scan finds 22.

The data directory holds `config.json` — `roots: ["repos"]`, `depth: 2`, without
which the default `roots: ["."]` and `depth: 2` would not reach
`repos/<group>/<repo>` — one review session `reviews/synth/` with `review.json`
and `comments.json` in the format of `docs/SPEC.md` section 7, and a `current`
pointer naming `synth`, so the fixture opens without `--review`
([03-storage.md](03-storage.md)). There is no `diff.json`: git is the source of
truth and the scanner writes that cache itself.

Comments are spread over all four anchor levels (review, repository, file, line)
and all four severities; a line comment's anchor names a line inside the block
its file actually changed, with its real context and hunk header.

## Determinism

Two runs with the same seed produce byte-identical trees outside `.git`. The
seed drives every choice, and the git author, committer, and dates are fixed
through environment variables, so the commits are reproducible too. `.git`
itself is not comparable: object mtimes differ, and the sibling worktree's
`.git` file holds an absolute path.

`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are pointed at the null device for
every git call, so a developer's own git configuration cannot change the
fixture.

The generator reaches its line target in two passes. A planned edit of `d` old
lines into `i` new ones does not yield `d + i` changed lines: realistic code
repeats `}` and blank lines, git matches those across the replaced block and
counts them as context — about a quarter of the plan on these profiles. The
first pass writes the plan and measures it; the second appends uniquely
numbered lines until the measured change set matches the profile exactly.

Top-up only adds lines, so a plan that overshot the profile could not be brought
back down. It cannot overshoot: every file is allotted a floor of changed lines
before the remainder is spread by weight, so the parts always sum to the profile
exactly. The generator checks the finished change set against the profile and
throws when they differ, which is what makes "exact, not approximate" a promise
rather than an observation.

## Verifying it by hand

```sh
bun run synth -- --out /tmp/a --small
bun run synth -- --out /tmp/b --small
diff -r --exclude=.git /tmp/a /tmp/b     # no output
```

`tests/synth.test.ts` runs the small profile twice in temporary directories and
checks the same properties: the profile counts, the tracked and untracked split,
the sibling worktree and the nested submodule, the on-disk format, that every
line comment sits on the line it names, that a foreign directory is refused
untouched, and that the two trees are byte-identical.

## The smoke matrix

`scripts/smoke.sh` runs one review from end to end through one delivery
channel. The channel is the command it is given, so the same scenario covers
all three of them:

```sh
scripts/smoke.sh node dist/cli.js                # the npm bundle on Node
scripts/smoke.sh bun src/cli/index.ts            # the sources on Bun
scripts/smoke.sh ./dist/diffalanche-darwin-arm64 # the binary of this platform
```

Run it from the repository root: the fixture comes from `bun run synth`, and the
command is taken as it is typed, so its paths are the ones a person would type
there. The words of the command must not contain spaces — a POSIX shell has one
list and the arguments are in it.

Everything happens under a temporary root that is removed on the way out, so no
repository of the checkout is read or written. The scenario is
[ADR-006](../adr/adr-006-verification.md)'s: the small synthetic profile is
generated into that root, then

| Step | What is checked |
|---|---|
| `review new smoke` | the session is created and becomes current |
| `diff --json` | the change set, and the anchor of the comment read out of it: a repository, a file, and a line the fixture really changed |
| `serve` in the background | `/api/review` answers with the same totals `diff --json` printed, `/` serves the review page, and the address is on stdout |
| `comment --role human` | the comment opens on the anchor the change set named |
| `list --json` | it comes back with its severity, its anchor, and its author |
| `list --unanswered --json` | the human's thread is there |
| `reply` | the reply's id is the first word of the line |
| `list --unanswered --json` | it is empty now: the agent has answered |
| `resolve --role human --note` | the thread closes, named by `--author` |
| `list --json`, `list --status resolved --json` | it is out of the open comments and carries both the reply and the note |
| `export --status all`, `--format json` | the comment is in the markdown under its repository, and in the JSON |
| the server is stopped | nothing answers on the port any more |

The unanswered check is made twice on purpose. An empty `list --unanswered`
after the reply proves nothing on its own — a thread that was never unanswered
is empty as well — so the comment is opened with `--role human` and the thread
is seen in the list before the agent replies to it.

A failure prints the command as it would be typed again, its exit code, and its
stderr; an expectation that did not hold prints the command, what was expected,
and the output it read. `serve` prints the same three things itself, and only
one of its deaths is retried: a port already in use, which Node and Bun word
differently and which the script matches both ways. Every other death is the
channel failing to serve — a `Bun.file` in the server on Node is exactly that —
and it stops the run with `serve`'s own exit code and stderr rather than being
counted as a busy port. The server counts as up only once it has printed the
address it listens on: something else already holding the port answers
`/api/review` with its own review, and a scenario that accepted it would test a
stranger's server.

The JSON is read with `jq` where there is one and with a small Node script where
there is not — a Windows runner has Node before it has jq — and both readers
answer the same three questions: the anchor out of the change set, the totals,
and one line per comment. No rows and a reader that broke are told apart:
`jq -e` exits 4 when a filter produced no output, which is what an empty comment
list is, and 2, 3, or 5 when the input or the filter was wrong. Without that
difference a `jq` that cannot parse the JSON would satisfy every expectation of
zero comments.

The script needs `bun` for the fixture, `curl` for the running server, and `git`,
which the generator uses. One channel takes about 4 seconds on an M1 Pro.

### The job

`smoke` in `.github/workflows/ci.yml` is the matrix of ADR-006: `node` on
ubuntu, macOS, and Windows, `bun` on ubuntu and macOS, and `binary` on ubuntu
and macOS, each building its own channel in the job that runs it. The binary job
builds the one binary it runs — `bun run build -- --target current` — rather
than all six and throwing five away; the name comes from `process.platform` and
`process.arch`.

Bun is pinned to the version of the other jobs where it is the toolchain that
builds the bundle and generates the fixture, and taken as `latest` in the `bun`
channel, where it is what is being tested: a Bun release that breaks the tool
shows up there. The Windows job is written and not verified — DA-45 runs it,
fixes what it finds, and makes it required — so until then it is
`continue-on-error` and a red one is something to read rather than a blocked
pull request.

## The runtime the unit suite runs on

`bun run test` reads as though the tests run on Bun. They do not: Bun starts
Vitest, and Vitest runs the tests themselves on Node. Inside a test
`process.execPath` is the Node binary, `process.versions.bun` is undefined, and
`globalThis.Bun` is not there. The whole unit suite was therefore only ever
executed on one of the two runtimes the tool promises, while the specification
(section 10) asks for CI green on Node and on Bun.

`bunx --bun vitest run` is what moves them across. Measured here, with a probe
writing `process.execPath` and `process.versions` out of a test:

| Command | `process.execPath` in a test | `process.versions.bun` |
|---|---|---|
| `bun run test` | the Node binary | undefined |
| `bun run test:bun` | the Bun binary | `1.3.14` |

The whole suite passes on both, and the Bun run is not the slower one: 19 files
and 246 tests, 11.0 s on Bun against 15.0 s on Node, measured back to back on an
M1 Pro under load — 8.9 s against 10.1 s in a quieter pair. So the
suite runs twice, once per runtime, rather than a runtime-sensitive subset of
it being picked out by hand: the modules where the two runtimes can differ are
storage's lock, the git reader, and the watcher, and a hand-picked subset is a
list that goes stale the first time a module is added to it.

`bun test` is not the same thing and is not what this does: that is Bun's own
runner with its own API, and the suite is written against Vitest.

```sh
bun run test       # Vitest on Node, the default
bun run test:bun   # the same suite on Bun's runtime
```

`tests/runtime.test.ts` is what keeps the promise honest. It compares the
runtime it finds against `DIFFALANCHE_TEST_RUNTIME`, which `test:bun` sets to
`bun` and which is `node` when nothing sets it. A Vitest release that goes back
to spawning Node workers turns that job red instead of passing it quietly, and a
`bunx --bun vitest run` typed by hand without the variable says which runtime it
actually got.

In CI this is the `test-bun` job of `.github/workflows/ci.yml`, beside `check`,
which is the Node half of the same suite. Both jobs print their runtime —
`bun -e 'console.log(process.versions)'` in one, `node -e …` in the other —
before running the suite, so the log says which runtime executed it and does not
leave the answer to an assertion the reader has to find.

## The measurement harness

`perf/harness.ts` holds the measurement, `perf/run.ts` the command around it.
One run starts the server on the fixture, opens the page in headless Chromium
through Playwright ([ADR-006](../adr/adr-006-verification.md)), and reports one
row per repetition:

```sh
bun run build:ui                          # the harness measures the built UI
bun perf/run.ts --fixture .perf/fixture   # one run, raw numbers
bun perf/run.ts --runs 3
```

| Option | Meaning |
|---|---|
| `--fixture <dir>` | Root of a synthetic review made by `bun run synth`. Default `.perf/fixture` |
| `--variant <name>` | Measure only this variant; repeatable. Default: all of them. There is one, `default` |
| `--runs <n>` | Repetitions per variant: a whole number of at least 1, anything else is an error. Default 1 for `perf/run.ts`, 3 for the gate |

The numbers come out as JSON on stdout, one object per run, with progress on
stderr.

| Field | What it is |
|---|---|
| `firstRenderMs` | From the review response being parsed to the frame that showed the review |
| `scrollLongTasks`, `scrollLongTaskMs` | Long tasks while scrolling the whole review, and their total |
| `cpuPerFrameMs` | Chromium's own `TaskDuration` over the scroll, divided by the frames of that scroll |
| `composerOpenMs`, `fileJumpMs` | Opening the composer placeholder, and the median of three jumps to a file |
| `updateMs` | From an edit of one file to the frame that showed it in that file's card |
| `frames`, `scrollDistancePx` | How many frames the scroll took and how far it went |

`updateMs` is the live-update path of `docs/SPEC.md` section 6, measured the way
it happens: the shipped page listens on `/api/events` because that is what it
does, the harness appends a line to a file of one repository, and the page
stamps the frame that showed the patched card. That is the watcher, the
debounce, the rescan, the stream, the fetch, the patch, and the paint — the
whole of what the person waits for. The card is scrolled into view before the
edit, so the diff being measured is on the screen and not only in the store, and
the appended line is looked for in the card afterwards, so a number produced by
some other event cannot pass for this one. The edit is taken back out
afterwards, so the fixture is what it was.

The scroll is one pass over the whole review at up to 600 frames, so the step is
`scrollHeight / 600` — far faster than a person scrolls, which is the point: it
is the stress case, not the typical one. Frame rate is not measured, because a
headless runner cannot measure it (`docs/SPEC.md` section 6); the long-task
count and the CPU time per frame stand in for it, and 120 fps stays a manual
check on a 120 Hz display.

The Phase 0 spike carried both candidate diff libraries and measured eight
combinations of library, highlighting, and virtualisation from one build. The
verdict is [ADR-008](../adr/adr-008-diff-rendering-verdict.md); DA-21 removed
the losing library and the query switches, so `VARIANTS` now holds the one page
that ships and the `--variant` option has one value. The reference of the UI
side is [08-ui.md](08-ui.md).

## The gate

`perf/budgets.ts` holds the budget table of `docs/SPEC.md` section 6 as code and
`perf/gate.ts` is the gate around it:

```sh
bun run perf                       # three runs, medians against the budgets
bun run perf -- --runs 5           # more runs
bun run perf -- --fixture /tmp/x   # another fixture
```

The gate makes the synthetic review if `.perf/fixture` is missing **or was made
by an older generator** — a fixture without the `current` pointer has no review
session, and the server refusing the review reads as a broken server rather than
as a stale directory — always rebuilds the UI, since a gate that measures a
stale build measures nothing, and then runs the harness three times on the page
as it ships.
It prints one row per budget line and exits 1 when the **median** of any line is
over budget. One slow run does not fail the build; two do.

```
| Metric | Budget | Median of 3 | |
|---|---|---|---|
| First render of the review after the server responds | 500 ms | 32.3 ms | ok |
| Scrolling the diff: long tasks | 0 tasks | 0 tasks | ok |
| Scrolling the diff: CPU per frame | 8.3 ms | 6.4 ms | ok |
| Opening the comment form | 50 ms | 13.9 ms | ok |
| Jumping to a file from the navigation | 50 ms | 7.7 ms | ok |
| Switching review sessions | 100 ms | 104.2 ms | DA-24.1 |
| Update after an edit in one repository | 300 ms | 221 ms | ok |
```

**Switching review sessions** is measured and printed with the task named
instead of a verdict: the number covers the whole wait, and what it says is that
a warm switch is just over the budget and a cold one — the first switch to a
session whose document the server has never built — is about five times over.
That is a question about where the built document is cached, not about the page,
and it is DA-24.1; until it is settled the line does not fail the build, which
is what `pendingUntil` is for.
**Update after an edit** covers the whole path — the watcher, the debounce, the
rescan, the stream, the fetch, the patch, and the paint — and fails the build
like any other line; on the machine this was written on it lands around 221 ms
of the 300, of which 100 ms is the watcher's own debounce.

Both of those windows are the whole wait on purpose. Only the first-render row
of `docs/SPEC.md` section 6 is qualified with "after the server responds"; a row
without that qualifier is measured from the moment the person acts, because that
is when their wait starts.

The session switch became measurable with DA-24. The fixture the generator
writes carries one review session and switching needs two, so the harness makes
the second itself, in `withServer`: a session with the same base, the first
one's change set copied into its `diff.json` — the same base is the same answer,
and copying it spares the run a rescan — and forty comments of its own, so the
swap really is a different set of threads. A run switches to it and back and
reports the slower of the two, which also leaves the fixture on the session it
found it on. What is timed is the whole swap: from the press to the frame that
shows the other review — the `POST` that makes it current, the read of the
review that follows it, and the render. Only the first-render row of
`docs/SPEC.md` section 6 is qualified with "after the server responds"; this one
is not, and a session whose change set still has to be computed is part of what
the reader waits for.

`8.3 ms` is the frame of 120 fps. The specification asks for 120 fps and a
headless runner cannot measure frame rate, so the gate checks the two things it
can: no long task at all, and CPU time per frame under one frame.

The gate is one of the `gates` of `backslop.json`, so it runs before any task is
reported, and it is the `perf` job of `.github/workflows/ci.yml`, which
installs Chromium, generates the fixture, and runs the gate — the gate builds
the UI itself, so the job does not; the table lands in the run summary through
`GITHUB_STEP_SUMMARY`. One local run takes about 33 seconds on
an M1 Pro, plus 4 seconds when the fixture has to be generated first.

## The CI jobs

`.github/workflows/ci.yml` holds five jobs, and each of them is described in
full where its subject is:

| Job | What it runs | Runners | Where it is described |
|---|---|---|---|
| `check` | `lint`, `typecheck`, and the unit suite on Node | ubuntu | [the runtime the unit suite runs on](#the-runtime-the-unit-suite-runs-on) |
| `test-bun` | the same unit suite on Bun's own runtime | ubuntu | [the runtime the unit suite runs on](#the-runtime-the-unit-suite-runs-on) |
| `perf` | the budget table on the synthetic review | ubuntu | [the gate](#the-gate) |
| `smoke` | one review end to end through one delivery channel | ubuntu, macOS, Windows | [the job](#the-job) |
| `e2e` | the acceptance list of specification section 10, against the binary | ubuntu, macOS | [08-ui.md](08-ui.md#the-acceptance-suite) |

`e2e` installs Chromium and runs `bun run test:e2e`, which is the one command a
developer runs: building the binary of the runner and generating the fixture are
the first steps of that suite's own web server command, so there is no second
place where the build could drift from it. Each criterion lands in the run
summary as a row, passed or failed, through `GITHUB_STEP_SUMMARY`, and a failed
run uploads `e2e/test-results/` as an artifact.

`bun run test:e2e` is not one of the `gates` of `backslop.json`, and the
absence is deliberate: a cold run builds the binary, which is about seventy
seconds, and the same criteria are checked in CI on two platforms rather than on
whichever one the author happened to have. Run it before a change to the server,
the CLI, or the scanner; the gates stay the fast ones.

`bun run test:ui` is not a job. Its screenshot baselines are per platform and
the ones in the repository were taken on macOS, so a Linux runner would compare
against pixels it never draws; the acceptance suite, which takes no screenshots,
is what CI runs instead ([08-ui.md](08-ui.md#ui-tests)).

## The release

The two delivery channels of [06-cli.md](06-cli.md) are published by one
workflow, `.github/workflows/release.yml`, triggered by one annotated tag:

```sh
bun run release 0.1.0               # the preflight, then the tag
bun run release 0.1.0 -- --dry-run  # the preflight, no tag
git push origin v0.1.0              # the owner's step, and the trigger
```

`scripts/release.ts` is the local half — everything that can be answered before
a tag exists, cheapest check first, so a failure costs the seconds before the
suite rather than a published version:

| Check | Fails when |
|---|---|
| version | `package.json` declares another version than the argument |
| working tree | `git status --porcelain` is not empty, untracked files included |
| branch | `HEAD` is not `main`, or is detached |
| tag | `v<version>` already exists |
| changelog | `CHANGELOG.md` has no `## [<version>]` section, or the section is empty, or there is no Unreleased one |
| suite | `bun run test` fails |

The changelog check reads the section the way the workflow reads it — from under
the heading to the next `## [` — rather than looking for the heading alone. A
heading with nothing under it would otherwise pass here and fail the workflow,
after six binaries have been built and the tag is already on the remote.

Then it writes `git tag -a v<version>` and stops. It never pushes: the push is
the owner's, and it is the whole trigger. It never edits a file either — moving
the Unreleased entries under a version heading is a commit made before the
release, because an edit made by the preflight would dirty the tree it has just
checked and the tag would point at the commit before that edit. The script says
which edit to make and refuses until it is committed.

The workflow does the rest, on the commit the tag names.

- **The version comes from the tag** — `GITHUB_REF_NAME` without its `v` — and
  is checked against `package.json` a second time, so a tag made by hand rather
  than by the script is caught before anything is published.
- **The release notes are read, not written:** the `## [<version>]` section of
  `CHANGELOG.md`, up to the next version heading. A version with no section, or
  one whose heading has nothing but blank lines under it, stops the release
  there.
- **One job builds all six binaries.** `bun build --compile` cross-compiles, so
  a matrix of six runners would install the toolchain and rebuild the same UI
  six times to emit one file each, and the checksums would have to be collected
  back from six uploads instead of computed over one directory. The binaries are
  not executed in this workflow: running each channel on its own platform is
  what the smoke matrix does, on the same commit.
- **`SHA256SUMS.txt`** is written over `dist/diffalanche-*` and attached to the
  release beside the six binaries. The step counts its own lines first — six
  targets, six lines — and then re-reads the files with `sha256sum -c`. What
  that rules out is a build that emitted fewer binaries than the six targets,
  which would otherwise produce a release quietly short of a platform; what it
  does not do is authenticate the download, which is the provenance
  attestation's job on the npm side and the release page's on this one.
- **npm is published with provenance:** `npm publish --provenance --access
  public` from the repository secret `NPM_TOKEN`, with `id-token: write` so npm
  can sign the attestation naming the commit and the run. The binaries stay out
  of the tarball — `files` in `package.json` lists `dist` and `skills` and
  excludes `dist/diffalanche-*`, which are release assets and about 490 MB of
  them.

The release is a draft until its binaries are on it — `gh release create
--draft`, then the upload, then `gh release edit --draft=false` — so the page
appears complete or not at all. Half a gigabyte takes time to upload and an
upload can fail; published first would mean a page carrying notes and no
downloads, for seconds when it works and until someone noticed when it did not.

The GitHub release is created before the npm publish, and the job can be re-run:
an existing release is reused rather than refused, and `gh release upload
--clobber` replaces the assets. That ordering and that idempotence are the same
decision — a published npm version cannot be taken back, so the step that can
fail on its own (a token, a name, a registry) is the last one, and retrying it
means re-running the job, which passes back through the release step.

A pre-release version — one with a `-`, such as `0.1.0-rc.1` — goes to the npm
`next` dist-tag and is marked a pre-release on GitHub, so `npx diffalanche`
keeps resolving to the last stable version.
