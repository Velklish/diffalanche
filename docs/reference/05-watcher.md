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
| `scan` | the `ScanResult` the review was built from: which repositories to watch. Its warnings are not read: what the walk said about a repository travels in the cache's `rootWarnings` ([02-git.md](02-git.md)) |
| `bus` | where events go |
| `activity` | the feed the events are recorded in |
| `debounceMs` | how long a repository stays quiet before it is rescanned; 100 ms |
| `pollIntervalMs` | how often a tree is walked where there is no recursive watch; 250 ms |
| `onRescan` | the session the rescan was about and the change set as it left it, for a caller that keeps it in memory |
| `onRepositoryChanged` | a repository that moved, **whatever the current task is about**: its change set inside the task's scope, its files outside |
| `sessions` | the tasks windows are open on, asked on every burst of the data directory |
| `recursive` | `false` walks every tree instead of watching it; the default asks the runtime |
| `onError` | a rescan that failed; without it the failure is silent |
| `onFallback` | a recursive watch died and the walk took its place; said once |
| `onWalk` | the session walks from the start although nobody asked it to — no recursive watch on this runtime, or `watch` refused a tree; said once, never for `recursive: false` |

The session it works on is the current one, read from the `current` pointer. It
follows that pointer: a session created from the UI or switched to with
`review use` needs no restart, and until there is a current session the watcher
watches without writing anything. **A move is followed only after the session
moved to has been read whole** — the read `refresh` does, below, in the same
queue — and `current-changed` goes out after that read: the session's
`diff.json` was last written when it was last followed, and the server trusts
the followed session's ([07-server.md](07-server.md)). A read that fails goes to
`onError`, and the session is followed all the same. The session's metadata
baseline is taken before that read, so a `review.json` written during it is a
`session-changed`; the repositories the read found different from the
`diff.json` it replaced are each a `diff-changed` with no files, after the
frame, and none of them is a line in the activity feed: a difference that may be
an hour old is the state the task is in, not something that just happened, and a
feed line would date it now and hand it to whichever agent wrote there last. A
window with no `?review=` reads the whole review on the frame and then fetches
each of those repositories again on its `diff-changed` — a second request for
what it already has, paid once per move. A session with no `diff.json` is not
read, since there is nothing to trust. The read is a task of the queue, so a rescan an edit starts meanwhile
waits for it: an edit right after `review use` is announced after the read, not
inside the 300 ms of `docs/SPEC.md` section 6 ([07-server.md](07-server.md)).

`startWatcher` resolves once every tree is being watched for real. **The
guarantee is the walk's**: it takes its baseline before it reports anything, and
a change made before that baseline exists would be part of it rather than a
change. The recursive watch has nothing to prepare and its `ready` is already
resolved — where a runtime arms its watch a moment after `watch` returns, as Bun
does, that moment is not covered, and it cannot be: arming a repository's watch
would mean writing into a repository, which the tool never does
(`docs/SPEC.md` section 11). What the probe arms is the data directory, which is
the tool's own.

`watcher.close()` stops every watch, drops the pending rescans, and **waits for
the one already running**: it answers a promise, and when that promise resolves
nothing more will be written into the data directory. A teardown may remove the
tree from that moment on. Without the wait a rescan inside its own `await` went
on holding the session lock and writing — re-creating `reviews/<name>/` under a
root that had just been removed, or failing into `onError` under whatever ran
next, and leaving the lock directory for the next writer to wait out. Neither
the recursive watch nor the polling timer keeps the process alive on its own —
the server's socket decides how long the process runs.

The walk of `src/core/watcher/tree.ts` is not part of that promise: its `tick`
can be in flight when `close` returns. It reads and writes nothing into the data
directory, so it changes nothing about what the guarantee says.

A rescan that fails is handed to `onError` and dropped: the queue stays usable,
and an `onError` that throws is caught too, because reporting a failure must not
become one.

`watcher.refresh()` reads the followed session's whole change set from the
working tree — every repository of its scope, the way a rescan with no cache to
patch does — hands it to `onRescan` and writes `diff.json`. It runs in the same
queue as the rescans, so a rescan that an edit started meanwhile waits for it and
patches what it wrote rather than a cache it is about to replace. It announces
nothing on the bus: it is what a server runs once, before its first document and
before any window can be listening, because nothing refreshed that cache while
no server ran ([07-server.md](07-server.md)), and what the watcher runs itself
on a move of `current`, before it follows the session moved to. Without a
`diff.json` it reads nothing: the first document reads the working tree anyway.
With no current session, or one whose `review.json` cannot be read, it does
nothing — the first document is the one that reports that.

## What it watches, and what it ignores

One watch per repository, plus one over the data directory. `fs.watch` with
`recursive: true` is the whole implementation where the runtime honours it;
where it does not, the same interface walks the tree on a timer and compares
modification time and size. A watch that **dies after it started** says so once,
through `onFallback`. A session that **walks from the start** says so once too,
through `onWalk`: the probe below answered that the runtime cannot recurse, or
`watch` itself refused one tree when it was built — Node's
`ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` does that to every tree, and `ENOENT`,
`EACCES` or `EMFILE` can do it to one — and the walk took the tree at
construction without going through the takeover. The line `serve` prints names
neither cause, because the one callback does not carry which it was: *a
recursive watch was not available*. The question is asked once
every tree is built and before any of them can have fallen back, so a tree that
is walking then has walked from the start. Nothing is rescanned for it: the
walk's first baseline *is* the startup baseline and nothing was missed, which is
the difference from the takeover below. `serve` turns it into one line on stderr,
and the takeover line is not said after it — the operator already knows the
session walks and why updates are slower (DA-85.1).

`recursive: false` skips the question and walks: a filesystem whose
notifications cannot be trusted — a network mount — is what it is for, and so is
a runtime whose watch goes quiet. It says nothing through `onWalk`: the walk is
the caller's own choice, and a line about it would tell the operator what they
asked for.

Accepting `recursive: true` is not the same as honouring it, so the answer comes
from a probe rather than from a version table: `supportsRecursiveWatch(dataDir)`
creates a temporary directory inside the data directory, watches it, and writes
a file one level down every fifty milliseconds until it is reported back or half
a second has passed. Writing once is not enough — Bun's watch arms a moment
after `watch` returns, and a single write lands before it does, which would
answer "this runtime cannot recurse" for the rest of the run. It runs once per
process — the answer is a property of the runtime, not of a directory — and no
reviewed repository is touched by it. Every write it makes is caught: a disk
that fills between the `mkdir` and the write answers "no" at once instead of
ending the process, because the probe's contract is a boolean and never a
throw, and its one caller has no error path. Measured with that probe: Node 25.2
and Bun 1.3 on macOS both recurse and both report the path relative to the
watched directory. A watch that fails after it started — an error from inotify or
FSEvents — closes itself and the walk takes over, rather than ending the process
with an unhandled event.

**The takeover has a window, and it is closed by re-reading rather than by
catching up.** The walk that replaces the watch opens with a baseline, and a
baseline is silent by construction, so everything written between the error and
the end of that first walk would be folded into it and never reported — on a
tree big enough to have exhausted the watch descriptors, that walk is not
instant. So the takeover itself is the signal: once the replacement's baseline
is taken, the tree is announced whole — a repository is rescanned, the data
directory is read again — and the edit made inside the window is in that read
whatever its name was. It over-reports by one rescan per tree and cannot
under-report. `ready` is the live one from then on: a caller that waits after a
takeover waits for the walk that replaced the watch, not for the watch that
died.

The operator hears it once. `onFallback` is called for the first tree that
falls back and not for the ones after it — the runtime gives up, not one tree —
and `serve` turns that into one line on stderr saying the trees are walked on a
timer and updates are slower. A session that has dropped to a walk cannot meet
the budget of `docs/SPEC.md` section 6 at all, which is why it is worth a line.

**A watch is not delivering when `watch` returns, and that holds for every
runtime here, not only for the probe above.** A write made in the window
between the call and the first delivery is lost outright rather than delayed, so
anything that measures a watch has to prove it is live first — by writing until
an event comes back, not by waiting longer for one write. Measured with the
watcher started and stopped thirty times on the small synthetic fixture, a file
written the moment `startWatcher` returned: **four of the thirty writes produced
no event at all** inside five seconds, while the other twenty-six produced one
in about 190 ms; with the same probe repeating the write until the watch
answered, thirty of thirty. That is why `tests/watcher.test.ts` arms the watch of
every repository it writes into before it measures anything: a
`no diff-changed within 20000 ms` there was never a slow machine, it was a write
nobody was listening for.

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
grow the cache for as long as the server runs. What drops them is a burst that
names the rules or git's own directory, and such a burst is a change in its own
right: `.gitignore` anywhere in the repository and `.git/info/exclude`, which
hold the rules, and **anything the watch reports inside `.git`, the bare
directory included** — `.git/index` decides which files the rules reach at all,
and one `git add -f` on a build output would otherwise leave every later edit of
a now-tracked file suppressed by a cached verdict.

The bare `.git` is in that rule rather than only the three files above, because
a runtime is free to collapse the name of a change inside the directory to the
directory itself — Bun does — and a `git add -f` reported that way would drop
nothing. What it costs is that a plain commit or branch switch discards the
repository's verdicts too, so a build writing into `dist/` pays one
`git check-ignore` again after one.

In the data directory every change is one signal: the reload reads `current`,
`comments.json`, `review.json`, and the status of every session, and compares
each with the last read, so a name that turns out to be the lock, or a temporary
file, or the directory itself costs a handful of small reads and says nothing.
Two things are left out: `diff.json`, because the watcher writes it, and everything under
`index/` — the embedding index, which the tool writes whenever a suggestion or `index rebuild`
brings it up to date and which no page shows ([09-ml.md](09-ml.md#the-index)); reading the
sessions again for it would queue a reload on the path an edit's update waits in. Matching on
the file name instead would drop the write:
`writeFileAtomic` renames a temporary file over the target, and a runtime may
report the temporary name, the target, or neither.

**A repository inside a repository is seen only through the outer watch**, since
the scan stops at a directory holding `.git` and never descends into it
([01-scanner.md](01-scanner.md)). Its working files are part of the outer tree
and wake the watcher like any others. Its git directory does not, with two
exceptions: `HEAD` and `packed-refs` at the top, and anything under
`refs/heads/`. Those three are where a gitlink points — `HEAD` moves on a
checkout, the branch ref on a commit — and the outer change set moves with them,
so suppressing them would hide a change the reviewer is meant to see. Everything
else under a nested `.git` is git's own bookkeeping and is left out, the walk
included: a `git fetch` down there writes into `objects/`, `logs/`,
`refs/remotes/` and `FETCH_HEAD` without the outer diff moving a line, and
before this it cost a `check-ignore` and a full rescan of the outer repository
per debounce window, plus a `stat` of every loose object on every tick of the
walk. What does come out of a nested `.git` is read the way the repository's own
is: git is not asked about it — a burst there is a change whatever a pattern
says, and one under a `vendor/` rule would otherwise be suppressed outright —
and it drops that repository's kept ignore verdicts.

A modern submodule never had that cost: its git directory is a file pointing at
`.git/modules/<name>` in the superproject, which the rule for the repository's
own `.git` prunes as a directory. What needs the rule above is a plain nested
clone, or an old-style submodule with a real `.git` directory in the working
tree.

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
window ends it instead, in place of the five git processes and the cache rewrite
a rescan costs. The rescan that follows reads that repository alone. Rescans run
one at a time: two of them write the same `diff.json`, and queueing costs less
than making each wait for the session lock. The write goes through the lock all
the same, because the CLI writes the same directory.

<!-- frames of WatcherEvent, fields without type — checked by tests/frame-tables.test.ts -->

| Event | Data | When |
|---|---|---|
| `diff-changed` | `{ repo, files }` | a repository was rescanned and its entry is not what it was; `files` are the paths that woke the watcher, not the files of the new change set, and it is **empty** when what woke it was the walk taking over a dead watch, or the read of a session `current` moved to — neither names a path |
| `comment-added` | `{ session, id }` | a comment appeared in the `comments.json` of a followed session |
| `reply-added` | `{ session, id, commentId }` | a reply appeared in a thread; `id` is the reply |
| `comment-status` | `{ session, id }` | a comment was resolved or reopened |
| `session-changed` | `{ name }` | the base, title, name, scope or status of a **followed** session changed |
| `current-changed` | `{ name }` | the `current` pointer moved to this session |
| `sessions-changed` | `{ name, status }` | a review task appeared in the data directory, or a task's status changed — whichever session it is |
| `warnings` | `{ list }` | the warnings of the change set are not what they were |

A file touched without its content changing — a build output written again, a
save with the same bytes — is not a change of the review: the recomputed entry
is compared with the cached one, patch by patch, and nothing is announced when
they agree. `session-changed` is the same kind of answer: every write to a
session bumps `updatedAt` in `review.json`, and only a change to what the review
*is* counts — its base, title, name, scope, or status.

**`current-changed` is a different piece of news and therefore a different
event.** One says a task changed; the other says the pointer moved to a task that
changed in no way. They used to share a name, and a window could not tell which
had happened: a window with no `?review=` must follow the pointer, because it
shows and writes to whatever `current` is, while a window on a task of its own
must ignore it. One name could not answer both, and the frame that means two
things carries no identity ([08-ui.md](08-ui.md)).

`sessions-changed` is the other half of that, and it is not the same event: a
task created by `review new --no-use` never becomes current, so nothing about
the current session changes and an open window would otherwise never hear that
it exists ([ADR-010](../adr/adr-010-review-task-scope.md)). It is read from the
status of every session under `reviews/`, one small file each, on every burst
the data directory produces — the cost `listSessions` already pays per request
([04-domain.md](04-domain.md)). A session that disappears says nothing: deleting
one is Phase 2 (DA-40).

**One press can produce both.** Closing the *current* task writes a `status`
that `metadataOf` reads and that the session snapshot compares, so
`session-changed` goes out from `reloadMetadata` and `sessions-changed` from
`reloadSessions` right after it — in that order, since `reloadData` reads the
three files in the order a change of one affects the others. A reader that
recognises its own writes has to keep the two apart: the UI does
([08-ui.md](08-ui.md)).

**A repository the current task is not about is watched and not rescanned.**
Watching it costs no git process, and it is what makes a scope that widens while
the server runs take effect without a restart; reading it would cost five git
processes to produce a change set nothing may show. The scope is re-read
whenever `review.json` changes, so a scope edit is in force from the next burst
on.

**It is still announced**, because the current task is not the only one with a
window open: a repository outside *its* scope is routinely inside the scope of a
task opened with `?review=`, and a server holding that task's document has to
know the repository moved ([07-server.md](07-server.md)).

`onRepositoryChanged` therefore fires from **two places, and they do not mean
quite the same thing**:

- **Inside the current task's scope**, from within the rescan, beside
  `diff-changed`. The rescan compares the recomputed entry with the cached one,
  so reaching that point means the change set really moved: a file touched
  without its content changing — a build output, a save with the same bytes —
  announces nothing.
- **Outside it**, from the burst itself, right after the ignore check. Nothing
  reads that repository, so nothing can say whether its content changed; the
  burst is the whole of what is known. A write that changes no line still
  reports, and a reader of the signal has to be able to afford that.

The price of the second is one `git check-ignore` per burst for repositories the
current task is not about, where before there was none: the ignore question now
comes first, so a build writing into an ignored directory of an unrelated
repository still says nothing. One process against the five a rescan costs —
the same trade the rescan path already makes, measured at about 20 ms over fifty
paths in `tests/watcher.test.ts`, one process for the whole window.

**The watcher follows the sessions windows are open on**, not `current` alone. It
keeps the comments and the metadata of each, and rescans none of them but the
current one: following a session is not scanning it, which is why a named task's
change set is still *built* from the working tree rather than kept fresh by a
rescan ([07-server.md](07-server.md)).

The set is `{current} ∪ the tasks live connections are on`, and it comes from the
live stream rather than from the server's document cache. A cache is a cache: its
eviction policy answers a question about memory, so it would drop a session whose
window is still open and keep one whose window has closed. A connection's
appearance *is* a window opening and its disappearance *is* that window going
away — the property the set needs, by definition rather than by proxy.

**A session entering the set is snapshotted without announcing anything**, and
its entry is dropped when it leaves. Otherwise a window opening on a task with
history would be told its whole history is new; a reconnect therefore costs one
silent snapshot rather than a burst. The three comment events carry the name of
the session their thread belongs to, so a window can drop what is not its own
([07-server.md](07-server.md)).

The cost is bounded by the number of open windows rather than by the number of
sessions in the data directory: `comments.json` is read for the followed ones
only. `review.json` costs nothing extra at all — the session listing reads every
one of them on the same burst anyway, and that single read is now handed to both
the metadata comparison and the listing.

Comment events come from reading `comments.json` and comparing it with the last
read, so a write from the UI, from one `diffalanche reply`, or from twenty of
them at once produces one event each and never two for the same write. The
author on the event is the author in the file. A file that cannot be read — one
being written as it is read, or one broken by hand — leaves the watcher without
a baseline rather than without a start, and the next readable version becomes
the baseline: what is in it then is what is there, not two hundred comments that
were all just added.

That read is caught where it happens, so it costs the comment events alone. The
reload goes on to `review.json` and to the status of every session, and
`session-changed` and `sessions-changed` keep arriving for as long as
`comments.json` stays broken — a base change, a scope edit, a task opened or
closed anywhere under `reviews/` are all still announced. The failure is handed
to `onError` once, on the way into the broken state rather than once per burst,
so a server prints one line about it instead of one per change of the data
directory.

## The change-set cache

The new change set is handed over the moment it exists and before it is written:
`diff.json` of a real review is megabytes, and writing it is the slowest step of
a rescan, so the update the person is waiting for does not wait for it. The file
follows a moment later, and a write that fails is repaired by the next rescan.

It is handed over **with the name of the session it is about**, which is the
session the watcher was following when the rescan started rather than whatever
`current` says by the time it ends. Between the hand-over and the write there is
a moment when the caller's memory is newer than the file, and that is the
caller's to hold: what the server does with it is in
[07-server.md](07-server.md).

A rescan replaces one repository's entry in `diff.json`, and its warnings, with
`replaceRepository` — the one patch of one repository, which the CLI's line
comment uses as well. What it keeps, what it drops, and why the lists it writes
are sorted is in [02-git.md](02-git.md). What the rescan adds around it is its
own: a repository whose recomputed entry equals the cached one is not written at
all, and the new change set is handed over before the write. The cache carries
the hunks: it is the only place they live, and anchor capture reads them there,
while the review response of the server drops them for speed.

With no cache at all — or with one computed against a base that is no longer the
session's — there is nothing to patch, and a cache holding the one repository
that changed would be read as a review of one repository, so the whole change
set is read instead, by `scanReview` of
[`src/core/change-set.ts`](../../src/core/change-set.ts). That read happens
outside the session lock, which is taken only for the write. A patched cache
keeps the base it records.

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
machine charges for five git processes and a rewrite of the cache: about 190 ms
all together on a quiet machine, of which 100 ms is the debounce, and two to
three times that while the rest of the test suite runs in parallel. The 190 ms
was measured when a read was four processes and is not measured again: the
fifth, `config --list`, starts beside the base resolution in one `Promise.all`
([02-git.md](02-git.md)), so it adds a process and no step to the path. The flat
number belongs to the performance gate, which measures a machine that is doing
nothing else — 220 ms there.

The `check-ignore` of the burst is on that path too, and it is one process
against the five of the rescan. Measured once rather than gated: about 20 ms
over fifty paths in `tests/watcher.test.ts`, with the update after an edit in
the same run where it was before.

A platform without a recursive watch cannot meet the budget at all: there the
interval of the walk is added to every measurement.
