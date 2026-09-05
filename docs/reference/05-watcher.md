# 05 · Watcher and activity events

`src/core/watcher` is what makes a review update by itself: it watches the
reviewed repositories and the data directory, rescans one repository when its
files change, rewrites that repository's entry in `diff.json`, and puts what
happened on an event bus other parts of the process listen to
([ADR-005](../adr/adr-005-live-update.md)). It reads repositories and writes
nothing into them; the only file it writes is the change-set cache of the data
directory.

## Starting it

```ts
const watcher = await startWatcher({ config, scan, bus, activity });
```

| Option | What it is |
|---|---|
| `config` | the loaded configuration: the root, the data directory, and `exclude` |
| `scan` | the `ScanResult` the review was built from: which repositories to watch, and what the scan warned about |
| `bus` | where events go |
| `activity` | the feed the events are recorded in |
| `debounceMs` | how long a repository stays quiet before it is rescanned; 100 ms |
| `pollIntervalMs` | how often a tree is walked where there is no recursive watch; 250 ms |
| `onRescan` | the change set as the rescan left it on disk, for a caller that keeps it in memory |
| `recursive` | `false` walks every tree instead of watching it; the default asks the runtime |
| `onError` | a rescan that failed; without it the failure is silent |

The session it works on is the current one, read from the `current` pointer. It
follows that pointer: a session created from the UI or switched to with
`review use` needs no restart, and until there is a current session the watcher
watches without writing anything.

`startWatcher` resolves once every tree is being watched for real. **The
guarantee is the walk's**: it takes its baseline before it reports anything, and
a change made before that baseline exists would be part of it rather than a
change. The recursive watch has nothing to prepare and its `ready` is already
resolved — where a runtime arms its watch a moment after `watch` returns, as Bun
does, that moment is not covered, and it cannot be: arming a repository's watch
would mean writing into a repository, which the tool never does
(`docs/SPEC.md` section 11). What the probe arms is the data directory, which is
the tool's own.

`watcher.close()` stops every watch and drops the pending rescans. Neither the
recursive watch nor the polling timer keeps the process alive on its own — the
server's socket decides how long the process runs.

A rescan that fails is handed to `onError` and dropped: the queue stays usable,
and an `onError` that throws is caught too, because reporting a failure must not
become one.

## What it watches, and what it ignores

One watch per repository, plus one over the data directory. `fs.watch` with
`recursive: true` is the whole implementation where the runtime honours it;
where it does not, the same interface walks the tree on a timer and compares
modification time and size. `watcher.polling()` says which of the two is
running.

`recursive: false` skips the question and walks: a filesystem whose
notifications cannot be trusted — a network mount — is what it is for, and so is
a runtime whose watch goes quiet.

Accepting `recursive: true` is not the same as honouring it, so the answer comes
from a probe rather than from a version table: `supportsRecursiveWatch(dataDir)`
creates a temporary directory inside the data directory, watches it, and writes
a file one level down every fifty milliseconds until it is reported back or half
a second has passed. Writing once is not enough — Bun's watch arms a moment
after `watch` returns, and a single write lands before it does, which would
answer "this runtime cannot recurse" for the rest of the run. It runs once per
process — the answer is a property of the runtime, not of a directory — and no
reviewed repository is touched by it. Measured with that probe: Node 25.2 and
Bun 1.3 on macOS both recurse and both report the path relative to the watched
directory. A watch that fails after it started — an error from inotify or
FSEvents — closes itself and the walk takes over, rather than ending the process
with an unhandled event.

**Bun's own test runner is the one place where the recursive watch is not used
here.** Under `bun run test:bun` a watch goes quiet after its first events, so
`tests/watcher.test.ts` passes `recursive: false` there and exercises the walk
instead; under Node the same tests exercise the watch. A server under Bun is not
affected — four consecutive edits against `bun src/cli/index.ts serve` on the
synthetic review each produced their event — and every other test in the suite
runs the same on both runtimes.

macOS coalesces the changes of one directory into a single notification, and a
runtime is free to report any of the names involved: Node reports the file, Bun
reports one of them and sometimes only the directory. That is why a change in
the data directory is one signal rather than a name to match — see below — and
why `.git` itself counts, not only `.git/HEAD`.

Inside a repository these are left out:

| Left out | Why |
|---|---|
| everything under `.git` except `HEAD`, `index`, and `info/exclude` | the first two move when the base of the change set does and the third holds ignore rules; the rest is git's own bookkeeping. `.git` itself is not left out: a runtime that reports the directory rather than the file inside it would otherwise never say that HEAD moved |
| any `node_modules` | not part of a review, and large enough to make the walk of the polling fallback cost real time |
| the `exclude` globs of `config.json` | matched against the path inside the repository and against the file's own name, the way the scanner matches them ([01-scanner.md](01-scanner.md)) |
| the data directory | on a root that is itself a repository the tool's own `diff.json` sits inside the watched tree, and without this writing it would wake the watcher that wrote it |

Everything else wakes the watcher, except what git itself ignores. Which paths
those are is git's answer, not a guess: once the debounce window closes,
`git check-ignore --stdin -z` is asked about the paths of that burst — one
process for the whole window, whatever the burst holds — and a burst whose every
path is ignored produces no rescan and no event at all. The index is read, so a
file that is tracked is never reported as ignored: it is in the diff whatever a
pattern says about it. `git status` would answer the same question and is not
used, because it refreshes the index and the tool never writes to a reviewed
repository (`docs/SPEC.md` section 11).

**Nothing under `.git` is ever suppressed**, and that is a rule of this module
rather than of git: git makes no exception for its own directory, so under a
`.gitignore` that starts with `*` — a whitelist — `check-ignore` answers that
`.git/HEAD` is ignored. A burst holding one of the paths the watch reports
inside `.git` is rescanned whatever the answer would be; without that, a commit
or a branch switch would be swallowed and the base of the review go stale
without a word. A git that could not answer at all is read the same way: the
burst is rescanned and nothing is kept from the failure.

The answers are kept per repository between bursts, so a build writing the same
`dist/` file a hundred times asks once. Each repository keeps at most 4096 of
them, oldest out first, so a build writing thousands of distinct paths cannot
grow the cache for as long as the server runs. Three paths drop what was kept
and are changes in their own right: `.gitignore` anywhere in the repository and
`.git/info/exclude`, which hold the rules, and `.git/index`, which decides which
files the rules reach at all — one `git add -f` on a build output would
otherwise leave every later edit of a now-tracked file suppressed by a cached
verdict.

In the data directory every change is one signal: the reload reads `current`,
`comments.json`, and `review.json` and compares each with the last read, so a
name that turns out to be the lock, or a temporary file, or the directory itself
costs three small reads and says nothing. Only `diff.json` is left out, because
the watcher writes it. Matching on the file name instead would drop the write:
`writeFileAtomic` renames a temporary file over the target, and a runtime may
report the temporary name, the target, or neither.

A repository found after the server started is not watched: the set of
repositories is the one the scan handed over. A linked worktree keeps its `HEAD`
and `index` in the main repository's directory, outside the watched tree, so a
commit made in a worktree is noticed through the files it changed rather than
through the two.

## Events

Changes are debounced per repository: a change restarts the wait, but never past
one second after the first one, so a build that writes into the working tree for
a minute still produces a rescan every second instead of none at all — and where
that build writes into a directory git ignores, the one `check-ignore` of the
window ends it instead, in place of the four git processes and the cache rewrite
a rescan costs. The rescan that follows reads that repository alone. Rescans run
one at a time: two of them write the same `diff.json`, and queueing costs less
than making each wait for the session lock. The write goes through the lock all
the same, because the CLI writes the same directory.

| Event | Data | When |
|---|---|---|
| `diff-changed` | `{ repo, files }` | a repository was rescanned and its entry is not what it was; `files` are the paths that woke the watcher, not the files of the new change set |
| `comment-added` | `{ id }` | a comment appeared in `comments.json` |
| `reply-added` | `{ id, commentId }` | a reply appeared in a thread; `id` is the reply |
| `comment-status` | `{ id }` | a comment was resolved or reopened |
| `session-changed` | `{ name }` | the `current` pointer moved, or the base, title, or name of the current session changed |
| `warnings` | `{ list }` | the warnings of the change set are not what they were |

A file touched without its content changing — a build output written again, a
save with the same bytes — is not a change of the review: the recomputed entry
is compared with the cached one, patch by patch, and nothing is announced when
they agree. `session-changed` is the same kind of answer: every write to a
session bumps `updatedAt` in `review.json`, and only a change to what the review
*is* counts.

Comment events come from reading `comments.json` and comparing it with the last
read, so a write from the UI, from one `diffalanche reply`, or from twenty of
them at once produces one event each and never two for the same write. The
author on the event is the author in the file. A file that cannot be read — one
being written as it is read, or one broken by hand — leaves the watcher without
a baseline rather than without a start, and the next readable version becomes
the baseline: what is in it then is what is there, not two hundred comments that
were all just added.

## The change-set cache

The new change set is handed over the moment it exists and before it is written:
`diff.json` of a real review is megabytes, and writing it is the slowest step of
a rescan, so the update the person is waiting for does not wait for it. The file
follows a moment later, and a write that fails is repaired by the next rescan.

A rescan replaces one repository's entry in `diff.json` and leaves the rest
alone. A repository left with no changes drops out of the cache, the way a scan
leaves it out. The cache carries the hunks: it is the only place they live, and
anchor capture reads them there, while the review response of the server drops
them for speed.

With no cache at all — or with one computed against a base that is no longer the
session's — there is nothing to patch, and a cache holding the one repository
that changed would be read as a review of one repository, so the whole change
set is read instead, by `scanReview` of
[`src/core/change-set.ts`](../../src/core/change-set.ts). That read happens
outside the session lock, which is taken only for the write. A patched cache
keeps the base it records.

The warnings of the cache are rebuilt around the rescanned repository: what the
cache says about the others stands, and what it said about this one is replaced
by what the fresh read and the scan say about it now. The list is sorted by path
and message, so an unchanged set of warnings does not look like a new one.

## The activity feed

The feed is derived from the events and lives in memory, capped at the last 200
lines; it is gone when the server stops. Each line is a verb with the author,
the repository, the file, and the moment it happened.

| Verb | The line it stands for |
|---|---|
| `changed` | diff changed in `<repo>` |
| `editing` | `<author>` is editing `<repo>` |
| `replied` | `<author>` replied in `<file>` |
| `commented` | `<author>` commented on `<file>` |

Only a write with `role: agent` is recorded: the feed exists to show the human
what the agents did, and their own comment is not news to them. An agent write
naming a repository makes that agent the author of the diff changes in it for
the next two minutes; past that the diff change is a plain `changed` again.

## Budget

`docs/SPEC.md` section 6 gives 300 ms from an edit in one repository to the
update. The performance gate measures that path now — an edit of one file to the
page holding that repository's new diff — and prints it with DA-25 named
instead of a verdict, because the render of the patched diff belongs in the same
number and is DA-25's ([11-perf.md](11-perf.md)). What `tests/watcher.test.ts`
measures is the
part that belongs here — the file write, the debounce, the rescan, and the
event — over three edits, and it asserts the median against **300 ms plus one
rescan of the same repository timed in the same conditions**, and only where the
tree is watched: on the walk the number is the interval and the cost of the walk
itself. That is the watcher's own share, because the rescan costs what the
machine charges for four git processes and a rewrite of the cache: about 190 ms
all together on a quiet machine, of which 100 ms is the debounce, and two to
three times that while the rest of the test suite runs in parallel. The flat
number belongs to the performance gate, which measures a machine that is doing
nothing else — 220 ms there.

The `check-ignore` of the burst is on that path too, and it is one process
against the four of the rescan. Measured once rather than gated: about 20 ms
over fifty paths in `tests/watcher.test.ts`, with the update after an edit in
the same run where it was before.

A platform without a recursive watch cannot meet the budget at all: there the
interval of the walk is added to every measurement.
