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
filling it, so it refuses a directory that exists, is not empty, and carries no
`synth.json` of its own: without that check `--out .` in a checkout would take
the working tree and its `.git` with it. Failure is one line on stderr and exit
code 1.

**The mark is `synth.json` and not `.diffalanche/`, and that difference is the
whole safety of the check.** A `.diffalanche/` is what *this tool* writes into
any folder somebody reviews, so treating it as the sign of a generated fixture
pointed the guard at exactly the directories it exists to protect: an `--out` or
a `--fixture` aimed at a real review's root would have passed the guard and
taken its sessions and comments with it. `synth.json` is written by the
generator and by nothing else. The cost is that a fixture made before the stamp
existed is refused once; the message says so, and deleting it by hand is the
answer.

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
  synth.json                     what the generator wrote, for a reader to check against
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

**Those two files are written at version 1 and stay there.** It is not a place
the DA-53 schema bump missed: the fixture is what a data directory written
before that bump looks like, so every reader that opens it — the perf gate, the
smoke matrix, and most of the suite — exercises the compatibility
`READABLE_VERSIONS` promises, instead of one test doing it alone. The tool
raises the files to the current version on its first write to them, which leaves
the generated fixture on disk as it was generated
([03-storage.md](03-storage.md#schema-versions)).

Comments are spread over all four anchor levels (review, repository, file, line)
and all four severities; a line comment's anchor names a line inside the block
its file actually changed, with its real context and hunk header. Each severity
has two texts of its own, so the texts cluster by severity: `suggest` is checked
on this review, and its vote needs clusters to vote in ([09-ml.md](09-ml.md#suggestions)).

`synth.json` at the root is the generator's stamp: the seed, the session name
`current` points at, the profile, and the thread and reply counts written into
that session. It is not read by the tool — `roots: ["repos"]` keeps it out of
every scan — and it exists so that a reader can tell this fixture from one that
drifted under it. The perf gate is that reader; see **The gate** below. It is
derived entirely from the seed and the profile, so it does not break the
byte-identical promise above.

## Determinism

Two runs with the same seed produce byte-identical trees outside `.git`. The
seed drives every choice, and the git author, committer, and dates are fixed
through environment variables, so the commits are reproducible too. `.git`
itself is not comparable: object mtimes differ, and the sibling worktree's
`.git` file holds an absolute path.

`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are pointed at the null device for
every git call, so a developer's own git configuration cannot change the
fixture.

## The fixture's environment

The same argument holds for the data directory, and it is one function rather
than three copies: `fixtureEnv()` of `src/core/config/index.ts` returns the pair
every harness runs its fixture under — `DIFFALANCHE_DATA_DIR` empty, which
counts as unset, and `XDG_CONFIG_HOME` pointing at a directory nothing writes
to. `vitest.config.ts` puts it in `test.env`; `e2e/playwright.config.ts` and
`e2e/acceptance.config.ts` put it on their own `process.env`, which both the
server they start and the CLI a spec shells out to inherit; `perf/gate.ts`
passes it to every child as an explicit `env`.

**The gate passes it and does not assign it**, because the gate runs on Bun and
the two runtimes disagree about what a child inherits. Measured here with a
parent that sets `process.env.PROBE = "yes"` and then calls `execFileSync` with
no `env` of its own:

| Parent runtime | What the child saw |
|---|---|
| `node` | `PROBE=yes` |
| `bun` 1.3.14 | `PROBE` unset |

Bun hands a child the environment the process **started** with, so an assignment
made after start reaches nothing: the gate assigned the pair, spawned
`perf/run.ts`, and the repetition resolved the data directory from the user
config after all — `no current review session` from a fixture that had one. The
Playwright configurations are not exposed to this because Playwright builds
`{ ...process.env, ...env }` itself at every spawn, so their assignment is read
at the moment the child is made.

Without it the fixture is not isolated from the person running it. `resolveDataDir`
takes `dataDir` of `$XDG_CONFIG_HOME/diffalanche/config.json` relative to the
root ([03-storage.md](03-storage.md)), which is right for a real root and wrong
for a fixture: a user config holding `{ "dataDir": ".agents/diffalanche" }` sent
the harness to `<fixture>/.agents/diffalanche`, where the generated session is
not, and the suites of a machine with that file could not start while the same
commit was green everywhere else. The variable and `--data-dir` on the command
line were the two workarounds; neither is needed now, and `bun run perf`,
`bun run test:ui` and `bun run test:e2e` take none.

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
one of its deaths is retried: a port already in use. `serve` words that one
itself — `port <n> is already in use: …` ([07-server.md](07-server.md)) — and
the script matches that sentence, plus the raw errno of Node and of Bun for a
build that lets one through; matching only the raw wordings, as it once did,
left the retry unable to fire at all. `tests/cli.test.ts` reads the pattern out
of the script and holds it against what `serve` prints for a taken port, so the
two cannot drift apart again. Every other death is the
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
`process.arch`. It runs `bun run model:fetch` first, as `e2e` does: the binary
embeds the pinned model from the user cache (09-ml.md).

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

Both jobs also run `bun run model:fetch` before the suite, behind an
`actions/cache` of `~/.cache/diffalanche/models` keyed by the hash of
`src/core/ml/embed/model.ts`: the embedding tests read the pinned model from the
user cache and fail rather than skip without it
([09-ml.md](09-ml.md#tests)).

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
| `--embedding <main\|worker>` | `perf/run.ts` only: rebuild the embedding index in a loop inside the server's process while the page is measured — the model on the server's own thread or on a worker — and print on stderr how long each run took and how late a 5 ms timer fired ([09-ml.md](09-ml.md#in-the-server)) |
| `--lag` | `perf/run.ts` only: the timer of `--embedding` with no model, the baseline to hold it against |

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

### The sizes of the embedding index

`perf/index-scale.ts` is not a gate: it prints the numbers
[09-ml.md](09-ml.md#how-far-brute-force-goes) records about the index, one JSON
line per measurement, so they can be taken again on another machine.

```sh
bun perf/index-scale.ts search                     # read and search, 1 000 to 100 000 random vectors
bun perf/index-scale.ts grow --data-dir <d> --from synth --copies 49   # 50 copies of a session
bun perf/index-scale.ts catch-up --data-dir <d> [--worker]   # the update after 200, 1 and 0 new comments
bun perf/index-scale.ts fake --data-dir <d> --size 20000               # an index of random vectors
/usr/bin/time -l bun perf/index-scale.ts query --data-dir <d>          # peak memory of one query
/usr/bin/time -l bun perf/index-scale.ts serve --root <copy of a fixture>  # the server's, first suggestion
```

`bun perf/suggest-vote.ts` is the same kind of script for `suggest`: forty
labelled comments asked for their neighbours with themselves left out, and the
severities right by `k` and temperature that chose the vote
([09-ml.md](09-ml.md#suggestions)).

`search` needs no model; `catch-up`, `query` and `serve` read it from the user
cache; `serve` removes the fixture's `index/` first and writes a new one, and
`catch-up` rewrites the index and adds one comment to the first session of the
data directory it is given — a copy, never the fixture.

## The gate

`perf/budgets.ts` holds the budget table of `docs/SPEC.md` section 6 as code and
`perf/gate.ts` is the gate around it:

```sh
bun run perf                       # three runs, medians against the budgets
bun run perf -- --runs 5           # more runs
bun run perf -- --fixture /tmp/x   # another fixture
```

**`--fixture` names a directory the gate owns and erases.** The gate empties it
before regenerating, so it asks the generator's own question first, in the
process that does the deleting: an existing path is accepted only when it is an
empty directory or one carrying a `synth.json` this generator wrote — **not** a
`.diffalanche/`, which is what the tool writes into any folder somebody reviews
and is therefore the mark of the thing the guard protects rather than of a
fixture — and a path that exists and is not a directory is refused. On top of that it refuses
three paths whatever they contain — the repository, every directory above it,
and the home directory — because none of them is ever a fixture. `bun run perf
-- --fixture .` from the repository root is the case the rule exists for: the
checkout has no `.diffalanche/`, and before the guard the gate would have taken
the working tree and its `.git` with it. Refusal is one line on stderr naming
the path, exit code 1, and nothing deleted. `perf/fixture.ts` holds the check;
`scripts/synth.ts` keeps its own, because it is also run by hand.

The gate makes the synthetic review when `.perf/fixture` is not what the
generator wrote — checked against `synth.json` rather than assumed, and the
reason is printed before the regeneration — always rebuilds the UI, since a gate
that measures a stale build measures nothing, and then runs the harness three times on the page
as it ships — **each repetition in a process of its own**, `perf/run.ts --runs 1`
with its own server and browser, the number read back from its stdout. The
second browser one process launches after a whole measurement stalls on Bun:
the page never reports ready, or a later step never returns, and Playwright's
own timeouts do not fire, while a process that measures once and exits
completes every time. The cause is not found; the shape that works is what the
gate runs.
It prints one row per budget line and exits 1 when the **median** of any line is
over its ceiling. One slow run does not fail the build; two do.

**Which numbers are enforced where.** On a development machine the ceilings
are the specification's numbers, as the table prints them. On a GitHub-hosted
runner (`GITHUB_ACTIONS=true`, the `perf` job) every `ms` ceiling is the
budget times `RUNNER_ALLOWANCE` in `perf/budgets.ts` — 2.1 — and the long-task
line stays at zero. The first run of the job on `ubuntu-latest` measured the
same commit a little over twice as slow on every millisecond line as the
machine the budgets were written on (CPU per frame 17.3 ms against 7.8, the
composer 50.5 against 22.6, first render 161 against 87) with zero long tasks
(DA-5.1); the allowance leaves about fifteen percent over that, so a regression
of a runner's own size is still red there, and a smaller one is red on the
development machine first. The table names the widened ceiling beside the
budget — `9.5 ms (20 on a runner)` — so a green runner is never read as the
strict number holding.

**The allowance is one multiplier, and it is tuned to one line.** It exists to
put a ceiling about fifteen percent over what `ubuntu-latest` actually
delivers, and it can only do that exactly for one row, because the rows are not
slow in the same proportion. **The row it is tuned to is CPU per frame**, which
is the tightest: 9.5 ms against a measured 17.3 gives 2.1, and a ceiling of
about 20. Every other row gets whatever 2.1 happens to produce — first render
ends up several times over what a runner measured, and that is accepted rather
than fixed. Seven per-row ceilings, all derived from the DA-5.1 readings of
2026-09-10 and all maintained by hand, cost more than they are worth.

So the rule is narrower than it looks: **moving the CPU-per-frame budget
recomputes the multiplier in the same pass; moving any other millisecond budget
does not touch it.** DA-56.4 is why the rule exists at all — it took CPU per
frame from 8.3 to 9.5 while the allowance stayed 2.5, which carried the runner
ceiling from 20.8 to 23.8 against the same measured 17.3 and turned fifteen
percent of headroom into thirty-eight, letting a regression the size of the
runner's own reading pass on CI unnoticed.

**What `bun run perf` means off a runner, and when it declines to say.** Off a
runner, and only there: `GITHUB_ACTIONS=true` turns the precondition off
entirely, because a hosted runner's load is not anybody's to control and the
allowance above is what stands in for it — a gate that declined on CI would be a
red job with nothing in it to fix. On a development machine the ceilings are the
specification's own numbers, and that only means something on a machine quiet
enough to measure. It often is not, so
the gate reads the one-minute load average per core — before the run, and again
after it, taking the busier of the two, because a machine that got busy halfway
through decided the numbers as much as one that started busy. Above
`LOAD_CEILING` in `perf/load.ts` it prints `unable to measure`, names the load,
and exits 1 without a budget verdict; before the run it does that without
measuring at all. The decision and the two options it beat are
[ADR-013](../adr/adr-013-perf-gate-off-ci.md).

So a red `bun run perf` is now one of three things, and the output says which
without the reader having to compare numbers:

| what it prints | what it means |
|---|---|
| `over budget: <lines>` | the median of a line is over its ceiling |
| `not measured: <lines>` | a line's samples could not be trusted (DA-69) |
| `unable to measure: load average …` | the machine was too busy for any number off it to be about the code |

**`DIFFALANCHE_PERF_IGNORE_LOAD=1`** measures anyway. It is for a run that wants
the numbers knowing what they are worth — comparing two trees back to back, say,
where the machine is the same on both sides. Under it the gate prints
`**Not evidence.**` and the load above the table and then behaves normally. It
takes that exact value and nothing else: a bypass armed by a stray `export
DIFFALANCHE_PERF_IGNORE_LOAD=maybe` would be the development allowance ADR-013
rejected, wearing another name.

**Where the threshold comes from.** `LOAD_CEILING` is 2.5 runnable tasks per
core, and it is a measurement rather than a choice — but a small one, stated
here so the next reader can disagree with the data rather than with the
mechanism. Fifteen `bun run perf` runs on 2026-09-21, on one 8-core M1 Pro, over
three trees (a branch, `ed81928`, `1193ab3`), with the one-minute average taken
at both ends of each run:

| busier end, per core | CPU per frame | long tasks |
|---|---|---|
| 0.80 – 1.40 (six runs) | 8.6 – 9.0 | 0, once 1 |
| 1.90 – 2.44 (two runs) | 8.8 | 0, once 1 |
| 3.25 – 8.53 (seven runs) | 8.6 – 10.2 | 0, 1 and 4 |

Below 2.5 the readings sit in a band half a millisecond wide; above it they
spread over 1.6 ms and the long-task count starts flipping between trees on the
same commit. That is the whole of the evidence: one machine, one session,
fifteen points, and one run below the ceiling that still produced a stray long
task. It is enough to separate "the machine decided this" from "the code did"
and not enough to defend the second decimal.

**What this machine measures today.** In the quietest window this session could
get — no other work on the machine, one-minute average 5.2 at the start, which is
this machine's own floor — CPU per frame came out **8.6 to 9.0 ms against a
budget of 8.3, on all three trees including `1193ab3`, which predates every task
of the DA-53…56 package.** The lowest single repetition of the whole window was
8.5.

What that says is about the page, not about the laptop: `cpuPerFrameMs` is the
application's own processor time per frame while scrolling, and the machine is
the instrument. At rest, on an M1 Pro, the scroll does not fit inside the frame
of 120 fps. What the window settles is narrower and is the part DA-56.3 owes:
**the line is not attributable to any task of this wave — it is red before the
package as well, at rest, on all three trees.** The owner settled what follows
from that on 2026-09-21: the gate is set on a number this machine reaches while
8.3 ms stays the goal of `docs/SPEC.md` section 6 — see **The CPU-per-frame
ceiling** below.

The update line is the opposite case, and the same window attributes it. `1193ab3`
measured 244 ms and 267 ms — inside the 300 ms budget, twice; `ed81928`, after
the package, measured 352 ms and 392 ms, over it, twice. The runs alternated
between the trees under one lock, so the machine state is the same on both
sides. The step DA-55.2 suspected and could not prove is real.

**A second window narrowed it to one commit.** Nine points over
`1193ab3..ed81928` — which is fourteen closed tasks and not the package's four —
one `bun run perf` each, one shared fixture, load average 7.6 to 10.8
throughout:

| commit | task | CPU per frame | update after an edit |
|---|---|---|---|
| `1193ab3` | before the package | 8.5 ms | **244 ms** ok |
| `2925a19` | DA-54 | 8.8 ms | **283 ms** ok |
| `4be4936` | DA-53 | 9.1 ms | **297 ms** ok |
| `1079222` | **DA-55** | 8.9 ms | **334 ms** FAIL |
| `a8d673b` | DA-56 | 8.9 ms | 344 ms FAIL |
| `c9305e1` | DA-57 | 8.8 ms | 315 ms FAIL |
| `fa004df` | DA-78 | 8.7 ms | 323 ms FAIL |
| `7308efa` | DA-90 | 8.8 ms | 334 ms FAIL |
| `ed81928` | the tip | 8.7 ms | 347 ms FAIL |

Everything up to and including DA-53 is at or under 297 ms; everything from
DA-55 on is at or over 315. **The step is `1079222`, DA-55.** That is consistent
with DA-55.2, which bracketed it to DA-55's own review round — both of that
round's commits are inside this one. `DA-90`, whose title names an added
directory flush on every atomic write, is innocent: the step is already there
four commits before it.

Two things about the method, because the window was not uniform. Every point
needs `DIFFALANCHE_DATA_DIR=.diffalanche`, not only the oldest: `fixtureEnv()`
arrived with DA-54.1, late in this range. And the two oldest points could not
read a `diff.json` the shared fixture carried from a newer schema — DA-53 is in
this range — so they were re-measured with the fixture reset to what the
generator writes. The reset does not flatter the number: `1193ab3` gave 244 ms
reset and 286 ms unreset, and `updateMs` is measured after the document is
built, so the first scan is not inside the window it times.

CPU per frame over the same nine points is 8.5 to 9.1 with no trend, which says
there is no scroll regression in this range — the line is simply above 8.3
everywhere, which is DA-56.4.

**And what the gate guarantees about the thing it measured.** A green table used
to mean two weaker things than it looked like, and both are closed (DA-69).

*The fixture is the one the generator wrote.* The old check was the existence of
`.diffalanche/current`, and `current` exists whatever it points at: the harness
makes its own second session for the switch, `createSession` makes that session
current, and a run killed before the pointer was put back left the fixture on it
for good. The gate now reads `synth.json` back and compares three things against
it — the profile, the session `current` names, and the thread and reply counts
in that session's `comments.json` — prints why they differ, and regenerates. The
harness's scratch session is called `perf-scratch`: a name of its own, which
cannot compose with itself the way `${current}-b` did, and which the check can
never mistake for the generated one. A scratch session that does not hold what
this run would write is rebuilt rather than reused, so one killed run costs one
run and not every run after it.

*A line the gate had no number for said `ok`.* `NaN > 500` is false and so is
`0 > 8.3`, so a metric that disappeared printed as an ordinary number. A line
whose samples cannot be trusted is now a third verdict beside `ok`, `FAIL` and
pending — `UNMEASURED` — which prints and exits 1, so the rest of the table
stays readable when one metric goes. Untrusted means absent, not finite, or — on
a millisecond line only — exactly zero: no step of this harness takes no time, so
a `0.0` there is a feed that stopped reporting. A count of zero long tasks is the
goal of that line and is trusted. The feed that could produce such a zero is
fixed at its source as well: `TaskDuration` missing from Chromium's metrics
throws where it can be named instead of standing in as `0`. The two reds are
different and the gate says which — `over budget: …` and `not measured: …`.

```
| Metric | Budget | Median of 3 | |
|---|---|---|---|
| First render of the review after the server responds | 500 ms | 32.3 ms | ok |
| Scrolling the diff: long tasks | 0 tasks | 0 tasks | ok |
| Scrolling the diff: CPU per frame | 9.5 ms | 8.7 ms | ok |
| Opening the comment form | 50 ms | 13.9 ms | ok |
| Jumping to a file from the navigation | 50 ms | 7.7 ms | ok |
| Switching review sessions | 100 ms | 70.9 ms | ok |
| Update after an edit in one repository | 300 ms | 221 ms | ok |
```

The switch row is from the run that made that line warm (DA-24.1); the rest of
the sample is the older capture it was written with, and the two are not one
run.

**Switching review sessions** covers the whole wait — the press, the request,
the read, the render — and fails the build like any other line. **It is the
budget of a return visit.** The server holds one built document per session
([07-server.md](07-server.md)), so the first switch to a session it has never
built is a cold path: the change set is read, counted and serialised with
nothing to answer from, and that switch is several times the budget. The harness
makes that first pass before the measured pair and prints it on stderr —
`first switch to a session, cold: <n> ms` — so the cold number is named rather
than warmed away silently; no budget line covers it, and it is paid once per
session per server lifetime.
**Update after an edit** covers the whole path — the watcher, the debounce, the
rescan, the stream, the fetch, the patch, and the paint — and fails the build
like any other line; on the machine this was written on it lands around 221 ms
of the 300, of which 100 ms is the watcher's own debounce. Taking the probe line
back out is an update down the same path, so a repetition ends once the card has
painted the restore, not after a fixed pause: a pause shorter than the restore
left the next repetition measuring an edit behind a rescan still in flight.

Both of those windows are the whole wait on purpose. Only the first-render row
of `docs/SPEC.md` section 6 is qualified with "after the server responds"; a row
without that qualifier is measured from the moment the person acts, because that
is when their wait starts.

The session switch became measurable with DA-24. The fixture the generator
writes carries one review session and switching needs two, so the harness makes
the second itself, in `withServer`: a session with the same base, the first
one's change set copied into its `diff.json` — the same base is the same answer,
and the copy is what the CLI reads there — and forty comments of its own, so
the swap really is a different set of threads. **Since DA-69 that is what every
repetition measures**: the scratch session is called `perf-scratch`, is built
after the current session's change set exists rather than before, and is rebuilt
when it does not hold those forty comments — before that fix the first
repetition on a freshly generated fixture switched to a session with none, and
the line said `ok` about an empty rail. **The copy no longer spares the run a
scan.** The server trusts `diff.json` only for the session the watcher follows
([07-server.md](07-server.md)), and that is never this one, so the first build
of it reads the whole root from the working tree: that is the cold number above,
and it is why the cold path is slower than the 513 ms DA-24.1 measured against
the copied cache. A run switches to it and back once without measuring, to pay
that build, then switches to it and back again and reports the slower of the
two, which also leaves the fixture on the session it found it on. What is timed
is the whole swap: from the press to the frame that shows the other review — the
read of that review, which the page asks for as `?review=<name>` rather than by
moving `current` ([ADR-010](../adr/adr-010-review-task-scope.md)), and the
render. Only the first-render row of
`docs/SPEC.md` section 6 is qualified with "after the server responds"; this one
is not, and a session whose change set still has to be computed is part of what
the reader waits for.

**The CPU-per-frame ceiling is 9.5 ms, and 8.3 ms is the goal it is measured
against.** The specification asks for 120 fps and a headless runner cannot
measure frame rate, so the gate checks the two things it can: no long task at
all, and CPU time per frame. One frame of 120 fps is 8.3 ms, and that is what
`docs/SPEC.md` section 6 asks for — but on 2026-09-21 this machine measured
8.5 to 9.1 ms over nine commits of the main branch, with no trend and no commit
of that range responsible (DA-56.4). A budget no commit meets gates nothing, so
the number the gate enforces is 9.5: about four percent over the worst reading
taken where ADR-013's precondition lets the gate answer at all, which still
catches a regression of the size the line was written for — removing the sticky
bar cost 0.8 ms. 10.0 ms would leave ten percent and catch almost nothing; 9.2
would sit against the worst reading and bring back the flapping ADR-013 exists
against. Closing the gap to 8.3 is its own work and has not been attempted.

The gate is the last of the seven `gates` of `backslop.json` — the seventh — so it runs before any task is
reported, and it is the `perf` job of `.github/workflows/ci.yml`, which
installs Chromium, generates the fixture, and runs the gate — the gate builds
the UI itself, so the job does not; the table lands in the run summary through
`GITHUB_STEP_SUMMARY`. One local run takes about 33 seconds on
an M1 Pro, plus 4 seconds when the fixture has to be generated first.

## Waits in the suites

A test that waits for something asserts about what it finds when the wait ends,
and a wait that ended too early reads the same as one that did not: the verdict
behind it simply never ran, and it prints green. So every wait in `tests/`,
`e2e/` and `perf/` is one of four kinds, and says which.

- **A condition with a generous deadline.** Poll for the thing itself — the
  frame, the event, the file in the change set, the paint — and give up after a
  deadline that only a hang reaches: 20 s for a watcher event or an SSE frame
  (`DEADLINE_MS` of `tests/events.test.ts`, `waitFor` and `settle` of
  `tests/watcher.test.ts`), 60 s for a test and 120 s for a hook
  (`vitest.config.ts`). A deadline is not a budget. A frame that arrives late on
  a loaded machine has arrived, and a deadline tight enough to fail it tests the
  machine. An expected *absence* is a condition too: wait for something queued
  after the thing that must not happen — the next event of the same queue, a
  frame on a second stream, a task created behind it — and then look.
- **An order, not a length.** Where nothing can be polled, a wait may lean on an
  order the platform guarantees: a macrotask queued behind another, the next
  painted frame, or a timer of the same delay set after the one it waits out —
  HTML runs timers of equal delay in the order they were set, which is how
  `e2e/repo-bar.spec.ts` waits out one 120 ms settle of the centre panel. An
  order covers only what it orders: a scroll the page makes afterwards, as cards
  mount, re-arms that timer, so the one test that reads what the panel chose
  polls for it instead. A clock the test
  drives is the same thing: `e2e/keyboard.spec.ts` times the toast on
  Playwright's `page.clock`, where wall time would let a loaded machine put the
  second press after the first toast was already gone.
- **A duration the test creates.** A body that holds a lock for a while, a floor
  under a millisecond timestamp, a pool item kept in flight across a macrotask:
  it waits for nothing, load only lengthens it, and a comment says it is a
  floor.
- **A wait for a party the test cannot see**, such as a writer on its way to a
  lock. It is derived from the same thing timed in the same run — the writer
  uncontended, the scan the locked writer must outrun — times a margin, over a
  floor (`tests/lock-writers.test.ts`). The residual is honest: the multiple is
  a heuristic, not a bound.

**A test's timeout is a deadline on a hang.** Vitest's defaults of 5 s per test
and 10 s per hook failed work that claims no time at all — the byte comparison
of two synthetic trees, the generation of a fixture in a hook — once the machine
was busy enough, so `vitest.config.ts` raises them for every file.

**Which assertion owns which number.** A budget held in two places to two rules
is a red that no longer means anything, so each number has one owner:

| Number | Owner | How it is held |
|---|---|---|
| The five budgets of `docs/SPEC.md` section 6 | `bun run perf` | the median of three repetitions, times `RUNNER_ALLOWANCE` on a runner, declined on a busy machine |
| 300 ms on top of one rescan: the watcher's own share of an update | `tests/watcher.test.ts`, "rescans the edited repository alone and has the new hunk in diff.json in time" | the median of three edits, each less one rescan of that repository timed beside it once the watcher's write has landed; only where the tree is watched |
| One frame for a jump from the tree | `e2e/sidebar.spec.ts`, "choosing a file brings its card into view on the frame the click produced" | the card is in view on the frame the click produced; the 50 ms is the gate's |
| 750 ms from a task made elsewhere to the header mark | `e2e/history.spec.ts`, `MARK_CEILING_MS` | one sample, 2.5 times the 300 ms of a live update; no gate line measures the mark, and the spec says why |
| `HEARTBEAT_MS`, 15 s, for the head of the live stream | `tests/events.test.ts`, "answers as soon as it is subscribed, without waiting for a heartbeat" | the head arrives before a heartbeat is due and its first bytes are not one |

A number printed and not held — `edit to diff-changed`, `reply written to
reply-added`, `check-ignore over 50 paths`, `file jump, one frame` — is there to
be read, and a latency with no owner in that table is printed rather than held.

## The CI jobs

`.github/workflows/ci.yml` holds six jobs, and each of them is described in
full where its subject is:

| Job | What it runs | Runners | Where it is described |
|---|---|---|---|
| `check` | `lint`, `typecheck`, and the unit suite on Node | ubuntu | [the runtime the unit suite runs on](#the-runtime-the-unit-suite-runs-on) |
| `test-bun` | the same unit suite on Bun's own runtime | ubuntu | [the runtime the unit suite runs on](#the-runtime-the-unit-suite-runs-on) |
| `perf` | the budget table on the synthetic review | ubuntu | [the gate](#the-gate) |
| `ui` | the Playwright UI suite, without the screenshot comparisons | ubuntu | [08-ui.md](08-ui.md#ui-tests) |
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

`bun run test:ui` **is** a gate and the `ui` job both, since DA-54.2. Its
screenshot baselines were taken on macOS and are the only ones there are, so the
two comparisons of `shell.spec.ts` declare the platform and skip anywhere else,
saying so; the job runs the suite as the gate does, and everything else in it
runs on Linux too ([08-ui.md](08-ui.md#ui-tests)). It is the sixth of the seven, placed between
`bun run test:bun` and `bun run perf` so that the two browser gates are
adjacent and a machine that has to serialise them serialises one window.

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
| suite | `bun run test` fails — and it needs the embedding model in the user cache, so run `bun run model:fetch` once before ([09-ml.md](09-ml.md#tests)) |

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
- **The model and the runtime are release assets too.** `bun run model:fetch`
  puts the pinned model in the runner's cache before the build — the binaries
  embed it — and `scripts/assets.ts "$RUNNER_TEMP/assets"` stages the nineteen
  files the npm channel downloads, the model's three and every platform's native
  runtime files under names like
  `onnxruntime-node-1.30.0-linux-x64-libonnxruntime.so.1`, each checked against
  its pin, and prints how many it staged ([09-ml.md](09-ml.md#delivery)).
- **`SHA256SUMS.txt`** is written over `dist/diffalanche-*` and the staged assets
  and attached to the release beside them. The step counts its own lines first —
  six binaries plus the assets the staging counted — and then re-reads every file
  with `sha256sum -c` from the directory it was summed in. What that rules out is
  a build that emitted fewer binaries, or a staging that left an asset out,
  which would otherwise produce a release quietly short of a platform; what it
  does not do is authenticate the download, which is the provenance
  attestation's job on the npm side and the release page's on this one.
  **The manifest is written to `$RUNNER_TEMP` and never into `dist/`**, and the
  release uploads it from there under the same name — that name is what a
  downloader is told to look for. `dist/` is what `npm publish` packs and this
  job publishes from the same tree with no rebuild in between, so a manifest
  left in it shipped in the tarball, listing binaries the tarball does not
  contain (DA-106). Writing it elsewhere makes that structural rather than a
  second exclusion in `files` to keep in sync. `sha256sum -c` resolves the
  manifest's paths against the current directory, so the binaries' lines are
  re-read from inside `dist/` and the assets' from their staging directory.
- **npm is published with provenance:** `npm publish --provenance --access
  public` from the repository secret `NPM_TOKEN`, with `id-token: write` so npm
  can sign the attestation naming the commit and the run. The binaries stay out
  of the tarball — `files` in `package.json` lists `dist` and `skills` and
  excludes `dist/diffalanche-*`, which are release assets, 233–290 MiB each
  with the model inside. What the tarball does carry is twenty-seven files:
  `package.json`, the readme, the licence, the changelog, `dist/cli.js`,
  `dist/embed-worker.js`, the built UI, the WASM of the symbol index in
  `dist/grammars/` ([ADR-015](../adr/adr-015-symbol-index-binding.md)), and the
  agent skills. **`bun run check:package` is what keeps it that way** — it runs
  `npm pack --dry-run --json` and refuses anything under `dist/` that is not
  `dist/cli.js`, `dist/embed-worker.js` or under `dist/ui/` or `dist/grammars/`, so a by-product of a build or a release
  step cannot ride along unnoticed. `scripts/check-package.ts` holds the rule,
  `tests/package.test.ts` holds it to what the release workflow actually does,
  and the `check` job of `ci.yml` runs it over a real tarball: a stray file
  should stop a merge, not a tag, which is why the check is not in the release
  job. Without the secret the step says so in a notice and stops green: the
  GitHub release is then the whole release, which is how a tag is published
  before the npm channel is opened.

The release is a draft until its binaries are on it — `gh release create
--draft`, then the upload, then `gh release edit --draft=false` — so the page
appears complete or not at all. A gigabyte and a half takes time to upload and an
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
