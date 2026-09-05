# 06 · CLI

`src/cli` is the whole agent contract: its flags, its output, and its exit codes
are what a skill is written against ([ADR-004](../adr/adr-004-agent-contract.md)).
The commands of `docs/SPEC.md` section 8 that exist today are below; the Phase 2
and Phase 4 rows — `suggest`, `index`, `model`, `insights`, and `review delete` —
are not written yet.

## Commands

| Command | What it does |
|---|---|
| `diffalanche serve [--port <n>] [--open] [--verbose]` | scans the root and serves the review and the UI on `127.0.0.1`; `--open` opens the browser, `--verbose` logs every request |
| `diffalanche review new <name> [--base <base>] [--title <text>]` | creates a review session and makes it current |
| `diffalanche review use <name>` | makes an existing session the current one |
| `diffalanche review list [--json]` | the sessions, most recently updated first; `--json` prints `{"sessions": […], "warnings": […]}` |
| `diffalanche review base <base>` | changes what the session's change set is read against |
| `diffalanche diff [--repo <path>] [--json\|--patch]` | the change set of the session; rewrites `diff.json` |
| `diffalanche list [--status <open\|resolved\|all>] [--repo <path>] [--severity <s>] [--unanswered] [--json]` | the comments of the session; default status `open` |
| `diffalanche show <id> [--json]` | one comment with its thread and its anchor |
| `diffalanche reply <id> --body <text\|-> [--author] [--role]` | a message in a thread; `-` reads standard input |
| `diffalanche comment [--repo <path>] [--path <p>] [--line <n>] [--end-line <n>] [--side <new\|old>] --severity <s> --body <text\|-> [--author] [--role]` | a new comment, anchor filled from the change set |
| `diffalanche resolve <id> --role human [--note <text>] [--author]` | close a thread |
| `diffalanche reopen <id> --role human [--note <text>] [--author]` | open it again |
| `diffalanche export [--status <open\|all>] [--format <md\|json>]` | the review as markdown grouped by repository |
| `diffalanche version` | the version of the package; also `--version` |
| `diffalanche --help` | the command list; also `-h`, `help`, and no arguments at all |

The same table is in the [README](../../README.md#the-cli), and
`tests/readme-cli.test.ts` fails when the two disagree: it renders `--help` for
every command through `run()` and compares the commands and flags it prints with
the ones the README documents, in both directions. A flag added here without a
README row is a red suite, not a stale page.

`<base>` is the four forms of `docs/SPEC.md` section 8: `head`, `branch`,
`branch:<name>`, or a ref. `review new` without `--base` creates a `head`
session — the working tree against HEAD, which needs neither a remote nor a
branch to be there.

The `warnings` of `review list --json` are storage's own: a directory under
`reviews/` with no `review.json` in it. They are printed with the sessions
rather than dropped, because a session that has gone missing looks exactly like
a session that was never there.

## Global flags

Every command takes these, and they go after the command: `diffalanche diff
--root ~/work`, not `diffalanche --root ~/work diff`.

| Flag | Default |
|---|---|
| `--review <name>` | the current session, from the `current` pointer |
| `--data-dir <dir>` | `<root>/.diffalanche` |
| `--root <dir>` | the current directory |
| `--help`, `-h` | prints the options of that command and does nothing else |

`--root` is with the two of the specification because the data directory is
derived from it: without it, no command run from anywhere but the root would
find the review. A `--root` that is not a directory that exists is exit code 1,
and so is a `--data-dir` that names a file; a `--data-dir` that does not exist
yet is not, because the data directory is the one place the tool creates.

`serve` starts the review server of [07-server.md](07-server.md): it scans the
root, reads the change set of the current session against that session's base
into `diff.json`, watches for changes, and listens on `127.0.0.1`. It prints the
address and the counters under it, or, on a root with no current session, the
line that says how to make one — the server serves the screen that offers it.
`--verbose` logs every request to stderr.

## Exit codes and where output goes

| Code | When | What is printed |
|---|---|---|
| 0 | the command did what it was asked | its output on stdout |
| 1 | a user error: an unknown command or flag, a missing argument, a value that is not one of the choices, anything the domain or storage refuses | one line on stderr, `diffalanche: ` and the message |
| 2 | anything the tool did not expect | the stack trace on stderr |

JSON goes to stdout and nothing else does: warnings of a scan are inside the
JSON when `--json` is given and on stderr when it is not, so `diffalanche diff
--json | jq` never has a warning mixed into it.

A refusal from the domain carries its own message (`no review session "x"`,
`branch: names no branch`); a refusal from storage names the file and the field
inside it. Both are exit code 1: they are answers, not faults.

## The change set

`diff` scans the whole root — the `roots` of `config.json` to `depth` levels —
reads every repository found against the session's base, and writes the result
to `reviews/<name>/diff.json` before printing it. What is printed with `--json`
is byte for byte what is written, which is what `docs/SPEC.md` section 7 means
by "the same set that `diff --json` prints". Without `--json` the same set is
printed as a unified patch — `--patch` is the explicit spelling of that default,
and asking for both at once is exit code 1. One `# <repository> (<branch>,
against <ref>)` line goes before each repository's files, and a file left out of
the diff gets `# <path>: binary, listed without content` or `# <path>:
too-large, listed without content` — the two omissions of
[02-git.md](02-git.md). That output is for
reading, not for `git apply`: the files of every repository are all `a/…` and
`b/…`, so two repositories in one patch would collide.

`--repo <path>` narrows what is printed — its repository, its warnings, and
totals counted again for it — and never narrows what is written: a cache with
one repository in it would tell the UI and the next `comment` that the rest of
the review has no changes. A path the scan found no repository at is exit code
1, `no repository "<path>" under the root`: an empty change set means the
repository is there and has nothing to show, and a mistyped flag must not print
the same thing as a clean review.

`diff.json` records the base it was computed with. `review base` changes what
the session asks, and a cache holding the answer to the previous question is not
patched one repository at a time — the next `comment` on a line rescans the
whole root instead. A `diff.json` written before that field existed has no base
to compare and counts as never scanned.

The scan asks for the structured hunks, which the review response leaves out. They are what the anchor of a line comment is captured from, and
`diff.json` is the only place they are kept.

## Comments

`--author` defaults to `agent` and `--role` to `agent`: an agent that names
neither is an agent (`docs/SPEC.md` section 8). Several agents on one session
sign with their own `--author` and narrow with `--repo`.

Every write goes through the domain, which holds the session's lock while it
reads, changes, and writes the file back, so two CLI processes and the UI
interleave without losing a message.

`--body -` reads all of standard input, which is how a finding with newlines in
it gets in without the shell mangling it. A body that is only whitespace is exit
code 1, from the pipe as well as from the flag.

`comment` writes the id it opened as the first word of its line, and `reply`
writes the reply's id the same way, so a script reads the id with `cut -d' '
-f1`.

**`--repo` is optional**, which is one step past the section 8 table: without it
the comment is on the whole review (`repo: null`), the level the on-disk format
of section 7 and the UI both have. The other levels follow the same nulls —
`--repo` alone is a repository, `--repo` with `--path` a file, and adding
`--line` a line. `--end-line` makes it a range, `--side` picks the side of the
diff and defaults to `new`.

A line anchor is captured from `diff.json`, and the repository the line is in is
read again before it is captured: a comment written right after an edit has to
point at the line that is there now. The cache is patched in place, never
replaced by the one repository. See
[02-git.md](02-git.md) for `refreshRepository`, which does it.

`resolve` and `reopen` need `--role human`; with the default role, or any other
value, they exit 1 and change nothing. The refusal is the domain's rather than
the shipped skills', because a skill is advice and an agent that never read one
could still close a thread ([ADR-004](../adr/adr-004-agent-contract.md)).

**`reopen` takes `--note` as well**, which is the second step past the section 8
table: it gives `--note` to `resolve` alone. The note is written into the thread
as a reply before the status changes; the domain's verdict carries one for both
operations, and a thread reopened without a word in it says nothing about why.

`list --unanswered` is the open threads whose last message is from a human: what
an agent has not answered yet. A reply from an agent takes a thread out of it.

`comment --repo` is checked against the repositories under the root before
anything is read or written, and a path none is at is exit code 1 with the same
message `diff` gives: a comment stored on a repository the review does not have
would show up in `list` and in `export` and nowhere in the UI, and a `comment`
that ends in exit 1 must not have rewritten `diff.json` on its way there.

`list --repo` is checked against something else — the repositories the session's
comments name. A repository that was renamed or removed still has everything
that was ever said about it, and `list` is how that is read back; asking the
file system would refuse the one question only `list` can answer. An unknown one
is exit code 1, `no comment in this review session is on "<path>"`.

`export --format md` is what the domain exports and the UI's `raw` tab shows;
`--format json` is `{"review": {…}, "comments": […]}`, the metadata with the
comments that the markdown was built from. Both default to the open comments.

## How a command is defined

One module per command under `src/cli/commands/`, each exporting its definitions
and what it does with them. The definitions are the single source of both the
`util.parseArgs` configuration and the `--help` text, so the flags a command
accepts and the flags it documents cannot drift apart. `src/cli/run.ts` matches
the arguments against the command names — the longest first, so `review new` is
found before a one-word `review` could be — and turns whatever the command
throws into the exit code.

`util.parseArgs` is Node's own and Bun ships it too, so the CLI needs no
argument library ([ADR-002](../adr/adr-002-stack-and-delivery.md)).

The tests that start the CLI from its TypeScript source spawn it with
`process.execPath`, which is Node under `bun run test` and Bun under `bun run
test:bun` — the unit suite runs on both runtimes, and
[11-perf.md](11-perf.md) says how. Under Node that source is read with the type
stripping of Node 22.18, which is why the development floor is higher than the
`engines.node` of the published bundle.

## The two channels

`src/cli/run.ts` holds the commands; the two entry points differ only in where
the built UI comes from.

| Channel | Entry | UI |
|---|---|---|
| npm, `npx diffalanche` on Node ≥ 22 | `dist/cli.js`, bundled from `src/cli/index.ts` | `dist/ui` next to the bundle |
| binary, one per platform | generated by `scripts/build.ts` | embedded in the executable |

`bun run build` builds the UI, the npm bundle, and the six binaries; `bun run
build:cli` builds the npm bundle alone. `bun run build -- --target
<platform>-<arch>` compiles one binary instead of six, and `--target current`
names the machine building — which is what a CI job that runs only the binary
of its own runner asks for. Sizes and start-up times are in
[ADR-008](../adr/adr-008-diff-rendering-verdict.md).

Both channels are checked with the same scenario, and so are the sources on
Bun: `scripts/smoke.sh <command>` runs one review from `review new` to `export`
through whichever CLI it is given, and the `smoke` job of
`.github/workflows/ci.yml` runs it on Node, on Bun, and against the binary of
the runner's platform. What it asks of each command is in
[11-perf.md](11-perf.md).

Run from source, `bun src/cli/index.ts serve` takes the UI from `dist/ui` two
levels up, which is where `bun run build:ui` puts it.

The two channels are published by one workflow from one tag, and they are
published differently: the npm channel is `dist/cli.js` and `dist/ui` in the
tarball, and the binaries are assets of the GitHub release with a
`SHA256SUMS.txt` beside them — `files` in `package.json` keeps them out of the
tarball, where 490 MB of executables for six platforms have no business being.
See [11-perf.md](11-perf.md).
