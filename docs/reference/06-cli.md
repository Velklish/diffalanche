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
| `diffalanche review new <name> [--base <base>] [--title <text>] [--repo <path>]… [--path <repo>:<file>]… [--no-use]` | creates a review session and makes it current; `--repo` and `--path` give it a scope, `--no-use` leaves `current` alone |
| `diffalanche review use <name>` | makes an existing session the current one |
| `diffalanche review list [--json]` | the sessions, most recently updated first, each with its scope and status; `--json` prints `{"sessions": […], "warnings": […]}` |
| `diffalanche review base <base>` | changes what the session's change set is read against |
| `diffalanche review scope [--json]` | what the session is about |
| `diffalanche review scope set [--repo <path>]… [--path <repo>:<file>]… [--drop-comments]` | replaces it |
| `diffalanche review scope add [--repo <path>]… [--path <repo>:<file>]…` | widens it |
| `diffalanche review scope remove [--repo <path>]… [--path <repo>:<file>]… [--drop-comments]` | narrows it |
| `diffalanche review close [<name>] --role human [--author <name>]` | marks the task closed |
| `diffalanche review reopen [<name>] --role human [--author <name>]` | opens it again |
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

## The scope of a task

A review session carries a scope — the repositories and the files it is about —
and everything the CLI answers, it answers inside it
([ADR-010](../adr/adr-010-review-task-scope.md)). A session with no scope is the
whole root, which is what every session used to be, and nothing below applies to
it.

`--repo <path>` and `--path <repo>:<file>` are repeated, once per entry:
`review new t --repo repos/core/cargos-api --path repos/platform/loads-search:app/cargo/cargo_404.py`.
The first colon of `--path` separates the two, so a file whose name has a colon
in it still reads. A repository the root has not, and a path of the wrong form —
absolute, trailing, or with a `.` or `..` segment — are exit code 1 before the
session is written: a task that shows nothing must not be left on disk for the
next `review list` to explain. Whether the file exists is not asked: a file in
the scope with nothing to show is kept by the task and left off the screen
([ADR-010](../adr/adr-010-review-task-scope.md)). Repeated flags are the one
place `util.parseArgs` is asked for `multiple`, and `texts()` reads the list.

**`--no-use` is how an agent proposes a task.** It writes the session, leaves
`current` where it is, and prints the address of the running server —
`http://127.0.0.1:<port>/?review=<name>` — on a line of its own, so the human
opens it when they are ready and a script reads it with `tail -1`. The port is
the configured one; whether a server is listening on it is not checked, because
the CLI works without one.

A scope is a literal list of paths and does not follow a rename: a renamed file
is at a path the scope does not name until `review scope add` or `review scope
set` names it. That is a decision (DA-53.2, [04-domain.md](04-domain.md)), not
a gap.

`review scope add` only widens: adding a path to a repository that is in as a
whole changes nothing, so it never leaves a comment outside the scope and never
asks for consent. `review scope remove` narrows, and **that is what
`--drop-comments` is for**: without it, a removal with comments anchored under
what it removes is exit code 1 with the count and the ids, and nothing is
written — not the scope and not `comments.json`. With it, the comments and the
scope are written in one step under one lock. Both refuse a session with no
scope: the whole root is as wide as a task gets, and there is nothing in it to
remove.

**`review scope set` replaces** — it is the one of the three that turns a
session about the whole root into a task about something. What it names becomes
the whole scope, so it narrows whatever it does not name, and it takes
`--drop-comments` for the same reason `remove` does and refuses the same way
without it. It is the CLI's half of `PUT /api/sessions/:name/scope`, which the
scope editor writes through ([07-server.md](07-server.md)): one write is one
state on both sides.

The two sides are not symmetrical yet, and this is the difference. The HTTP
route takes `scope: null` and puts a task back to the whole root; `review scope
set` needs at least one `--repo` or `--path` and has no spelling for "none", so
a scoped session is widened back only through the editor. `review scope remove`
does not close that either: it refuses to empty a scope.

`review close` and `review reopen` take the name after the command, else
`--review`, else the current session. Both need `--role human` and refuse any
other role with exit code 1, changing nothing — the rule `resolve` has had since
[ADR-004](../adr/adr-004-agent-contract.md), reaching from a thread to the task
the threads are in. `closedBy` is `--author` and `closedAt` is the clock.
Closing marks the task; `comment`, `reply`, and `resolve` all still work on a
closed one.

## Global flags

Every command takes these, and they go after the command: `diffalanche diff
--root ~/work`, not `diffalanche --root ~/work diff`.

| Flag | Default |
|---|---|
| `--review <name>` | the current session, from the `current` pointer |
| `--data-dir <dir>` | `DIFFALANCHE_DATA_DIR`, then `dataDir` of `$XDG_CONFIG_HOME/diffalanche/config.json` (`~/.config` without the variable), then `<root>/.diffalanche` |
| `--root <dir>` | the current directory |
| `--help`, `-h` | prints the options of that command and does nothing else |

**`--review` names a session on every command, and a name no session has is exit
code 1 on every one of them.** `version` is the only command that reads no
session at all. On `serve` the flag means the task the address it prints is on —
see below — rather than the only task the server will answer about: the server
answers about every task, one per request
([07-server.md](07-server.md)).

`--root` is with the two of the specification because the data directory is
derived from it: without it, no command run from anywhere but the root would
find the review. A `--root` that is not a directory that exists is exit code 1,
and so is a `--data-dir` that names a file; a `--data-dir` that does not exist
yet is not, because the data directory is the one place the tool creates.

Without the flag, `loadConfig` ([03-storage.md](03-storage.md)) asks the
environment and then the user config before falling back to the root: the
flag is this run, the variable is this shell, the user config is this person.
A relative flag is resolved against the current directory, a relative variable
or `dataDir` against the root. An empty variable counts as unset. Only
`dataDir` is read from the user config; a `dataDir` that is not a string is
refused naming that file and the field, like a broken value of `config.json`.

`serve` starts the review server of [07-server.md](07-server.md): it scans the
root, reads the change set of the current session against that session's base
into `diff.json`, watches for changes, and listens on `127.0.0.1`. It prints the
address and the counters under it, or, on a root with no current session, the
line that says how to make one — the server serves the screen that offers it.
`--verbose` logs every request to stderr.

**`--review <name>` on `serve` is the task the printed address is on.** The
address becomes `http://127.0.0.1:<port>/?review=<name>`, the counters under it
are that task's, and `--open` opens that address rather than the bare one;
`current` is not moved, which is the point — `review new <name> --no-use` prints
the same shape of link so an agent can hand a human a task without taking over
the screen they are on
([ADR-010](../adr/adr-010-review-task-scope.md)). The name is resolved before
the socket opens, so a misspelling is exit code 1 with the domain's own
`no review session "…"` and no server is left running. Without the flag the
address is the bare one and the counters are the current session's, exactly as
before: `current` never enters the address on its own.

The server behind that address still answers about every task, one per request,
so the flag narrows nothing — it chooses the window. One thing it does not
change is which session the watcher follows: that is the current one whatever
the page asks for, so a window on another task hears no live event about *its*
comments ([07-server.md](07-server.md),
[DA-55.1](../backlog/queue/DA-55.1-watcher-follows-one-session.md)).

**`serve` exits non-zero only for what stops it from starting**, and everything
after the socket opens is a line rather than an exit. A file of the data
directory that cannot be read — a hand-edited `comments.json`, a `review.json`
of another schema version — is one of those: the server starts on it by design,
because refusing to start would leave the person with no way to see why
([07-server.md](07-server.md), "Refusals"), and the line under the address says

```
  the review could not be read: the address above says which file and what is wrong in it
```

instead of the counters. The file and the fault are named twice over — on stderr
as the server starts, and by the address itself, which answers `500`
`error: "storage"` with them. The first-run line is a different line because the
remedy is different: `review new` fixes a root with no session and fixes nothing
here.

## Exit codes and where output goes

| Code | When | What is printed |
|---|---|---|
| 0 | the command did what it was asked | its output on stdout |
| 1 | a user error: an unknown command or flag, a missing argument, a value that is not one of the choices, anything the domain or storage refuses, and a refusal from the environment the tool worded on purpose | one line on stderr, `diffalanche: ` and the message |
| 2 | anything the tool did not expect | the stack trace on stderr |

**A refusal the tool worded is exit code 1, whoever refused.** The domain and
storage are the two that refuse most, but the environment refuses too: a port
that is taken or not this user's, a data directory that cannot be created.
Where the tool has a sentence for one of those, it is an answer and not a
fault — the remedy is a flag or a permission the person can change, and a stack
trace says nothing they can act on:

```
diffalanche: port 4880 is already in use: stop the diffalanche that holds it, or run with --port <n>
diffalanche: port 80 is not allowed for this user: run with --port <n> above 1023
diffalanche: /srv/shared/.diffalanche: could not be created: permission denied
```

The set of worded refusals is closed on purpose, and everything outside it keeps
the stack trace and exit code 2. A listening socket refused with an `EPERM` or
an `EAFNOSUPPORT`, a `mkdir` that fails with something the directory helper does
not name — those are what the tool did not expect, and the trace is the only
useful thing to say about them.

JSON goes to stdout and nothing else does: warnings of a scan are inside the
JSON when `--json` is given and on stderr when it is not, so `diffalanche diff
--json | jq` never has a warning mixed into it.

**A reader that goes away first is exit code 0 and nothing on stderr.**
`diffalanche diff | head` is a normal way to use a CLI: the reader got what it
asked for, the rest of the write has nowhere to go, and there is nothing to
report. Without a handler on the stream that `EPIPE` is an unhandled `'error'`
event — a Node internals stack trace and exit code 1, which is the table's row
for a refusal the tool never made. The writes are single and large enough to
reach it: `diff` emits the whole change set in one call, against a synthetic
review of 30 000 lines. Both entry points take their streams from one place, so
the npm channel and the binary answer the same way; under Bun the runtime never
aborted on it to begin with.

Any other fault of a stream — a full disk on a redirected stdout — is **not**
swallowed with it: it is one line on stderr naming the stream and the fault, and
exit code 2, because output the person asked for did not arrive and nothing
about that is expected.

A refusal from the domain carries its own message (`no review session "x"`,
`branch: names no branch`); a refusal from storage names the file and the field
inside it. Both are exit code 1: they are answers, not faults.

## The change set

`diff` walks the whole root — the `roots` of `config.json` to `depth` levels —
reads every repository of the session's scope against the session's base, and
writes the result to `reviews/<name>/diff.json` before printing it. The walk
stays whole because it starts no git process and is what tells a repository the
scope names but the root has not from one that is simply quiet; the reading is
what the scope narrows, and a task over two repositories of twenty-one does not
pay for the other nineteen. What is printed with `--json`
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

The write goes through the session's lock, like every other writer of
`diff.json`. The interleaving it is there for is the one `assertHeld` cannot
catch, because the command never contends for the lock at all: a watcher takes
the lock and reads the cache, `diff` finishes its scan and writes a fresh one
over it, and the watcher then writes back what it read with one repository
patched into it — holding the lock honestly the whole time. Everything the scan
found for the other repositories is gone, and because the cache still answers for
the same base and the same scope, the server serves it unchanged until an fs
event fires ([03-storage.md](03-storage.md), [05-watcher.md](05-watcher.md)).

That lock is a third way `diff` exits 1, beside the two refusals above. A lock a
running `serve` or another `diff` still holds when `timeoutMs` runs out is a
`StorageError` naming the holder and the instant its lease runs to, and the scan
is thrown away with `diff.json` left exactly as it was: the run prints nothing
and writes nothing. So the header of the command — every run rescans the root and
rewrites the cache — holds for a run that exits 0.

`--repo <path>` narrows what is printed — its repository, its warnings, and
totals counted again for it — and never narrows what is written: a cache with
one repository in it would tell the UI and the next `comment` that the rest of
the review has no changes. A path the scan found no repository at is exit code
1, `no repository "<path>" under the root`: an empty change set means the
repository is there and has nothing to show, and a mistyped flag must not print
the same thing as a clean review. A repository the root has but the task is not
about is exit code 1 too, with its own message naming the scope, for the same
reason: printing nothing would read as "nothing changed there".

`diff.json` records the base **and the scope** it was computed for. `review
base` and a scope edit change what the session asks, and a cache holding the
answer to the previous question is not patched one repository at a time — the
next `comment` on a line rescans the whole root instead. A `diff.json` written
before either field existed cannot say what it answers and counts as never
scanned.

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

`list`, `show`, and `export` answer inside the scope of the session they run
against, and so do `reply`, `resolve`, and `reopen`: a comment outside it is not
in the list, and the other five give it the same refusal a comment of another
session gets. Nothing can write such a comment, so this is what a hand-edited
`comments.json` meets.

`comment --repo` is checked against the repositories under the root before
anything is read or written, and a path none is at is exit code 1 with the same
message `diff` gives: a comment stored on a repository the review does not have
would show up in `list` and in `export` and nowhere in the UI, and a `comment`
that ends in exit 1 must not have rewritten `diff.json` on its way there.

**Then it is checked against the scope**, and an anchor the task is not about —
a repository, or a file of a repository the task holds only some files of — is
exit code 1 naming what the task *is* about. The check runs before the
repository is read again, so a refusal costs no git process, and the domain
makes it too, for every caller ([04-domain.md](04-domain.md)). A comment outside
the scope would be written where `list`, `show`, and `export` will not return
it; the change belongs to another task, and the message says so.

**And then the anchor levels**, in the same place and for the same reason: a
`--line` without a `--path`, a `--line 4 --end-line 2`, a `--line 0`, an
`--end-line` with no `--line`. These are exit code 1 from the domain's own
`assertAnchorLevels` ([04-domain.md](04-domain.md)), called here before the
repository is read rather than left to `addComment` after it. Until this they
were the one refusal of `comment` that did rewrite `diff.json` on its way out —
a forgotten `--path` spawned the git processes for that repository and left the
watcher and every open window a write from a command that wrote no comment.

**"It did not rewrite `diff.json`" is asserted by the time of the write, not by
the bytes.** `refreshRepository` puts the *same* bytes back when the repository
has not changed since the last scan, which is the state a fixture is in, so a
byte comparison holds whether the refusal rescanned or not and the test named
after the invariant cannot fail. `tests/helpers/untouched.ts` is the one way the
suite says it: it stamps the file's mtime to a fixed instant in 2020 before the
command and asserts both the stamp and the bytes after it. Measured: with
`assertAnchorLevels` replaced by `void assertAnchorLevels;`, the byte comparison
alone exited 0 on all 17 checks while the refusal did rescan, and the stamped
one exited 1 naming the file that was written.

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
