# 11 · Synthetic review generator and the performance gate

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
`repos/<group>/<repo>` — and one review session `reviews/synth/` with
`review.json` and `comments.json` in the format of `docs/SPEC.md` section 7.
There is no `diff.json`: git is the source of truth and the scanner writes that
cache itself. There is no `current` pointer either — `docs/SPEC.md` section 7
names that file but does not fix its content, and the storage subsystem is what
defines it, so until then a consumer of the fixture names the session with
`--review synth`.

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

## The measurement harness

`perf/harness.ts` holds the measurement, `perf/run.ts` the command around it.
One run starts the server on the fixture, opens the page in headless Chromium
through Playwright ([ADR-006](../adr/adr-006-verification.md)), and reports one
row per variant and repetition:

```sh
bun run build:ui                                   # the harness measures the built UI
bun perf/run.ts --fixture .perf/fixture            # every variant, one run each
bun perf/run.ts --variant react-diff-view-virtual --runs 3
```

| Option | Meaning |
|---|---|
| `--fixture <dir>` | Root of a synthetic review made by `bun run synth`. Default `.perf/fixture` |
| `--variant <name>` | Measure only this variant; repeatable. Default: all of them |
| `--runs <n>` | Repetitions per variant: a whole number of at least 1, anything else is an error. Default 1 for `perf/run.ts`, 3 for the gate |

The numbers come out as JSON on stdout, one object per run, with progress on
stderr.

| Field | What it is |
|---|---|
| `firstRenderMs` | From the review response being parsed to the frame that showed the review |
| `scrollLongTasks`, `scrollLongTaskMs` | Long tasks while scrolling the whole review, and their total |
| `cpuPerFrameMs` | Chromium's own `TaskDuration` over the scroll, divided by the frames of that scroll |
| `composerOpenMs`, `fileJumpMs` | Opening the composer placeholder, and the median of three jumps to a file |
| `frames`, `scrollDistancePx` | How many frames the scroll took and how far it went |

The scroll is one pass over the whole review at up to 600 frames, so the step is
`scrollHeight / 600` — far faster than a person scrolls, which is the point: it
is the stress case, not the typical one. Frame rate is not measured, because a
headless runner cannot measure it (`docs/SPEC.md` section 6); the long-task
count and the CPU time per frame stand in for it, and 120 fps stays a manual
check on a 120 Hz display.

The variants exist for the Phase 0 spike; which combination the product uses is
[ADR-008](../adr/adr-008-diff-rendering-verdict.md), and the reference of the UI
side is [08-ui.md](08-ui.md).

## The gate

`perf/budgets.ts` holds the budget table of `docs/SPEC.md` section 6 as code and
`perf/gate.ts` is the gate around it:

```sh
bun run perf                       # three runs, medians against the budgets
bun run perf -- --runs 5           # more runs
bun run perf -- --fixture /tmp/x   # another fixture
```

The gate makes the synthetic review if `.perf/fixture` is missing, always
rebuilds the UI — a gate that measures a stale build measures nothing — and then
runs the harness three times on the page as it ships, without a variant query.
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
| Switching review sessions | 100 ms | pending | DA-9 |
| Update after an edit in one repository | 300 ms | pending | DA-25 |
```

Two lines are **pending**: nothing in the code can switch a session or change a
file under an open review yet. A pending line is printed and never fails; the
task named in the last column — DA-9 for sessions, DA-25 for live update — makes
it measurable and gives its budget line a field to read.

`8.3 ms` is the frame of 120 fps. The specification asks for 120 fps and a
headless runner cannot measure frame rate, so the gate checks the two things it
can: no long task at all, and CPU time per frame under one frame.

The gate is one of the `gates` of `backslop.json`, so it runs before any task is
reported, and it is the `perf` job of `.github/workflows/ci.yml`, which
installs Chromium, generates the fixture, and runs the gate — the gate builds
the UI itself, so the job does not; the table lands in the run summary through
`GITHUB_STEP_SUMMARY`. One local run takes about 33 seconds on
an M1 Pro, plus 4 seconds when the fixture has to be generated first.
