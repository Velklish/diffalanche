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
| `onDataChanged` | the data directory changed — any file of it but the two it leaves out below, about any task — said on the change itself, before the burst's quiet and before anything is read, and on a takeover by the walk; the server marks its held documents with it ([07-server.md](07-server.md)) |
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
And the read can take in an edit made while it runs, so that edit's rescan finds
nothing new: after a move, **the first rescan of each repository reports it to
`onRepositoryChanged` whatever it finds**, once, so a document another task holds
of that repository is not left showing what the edit replaced
([07-server.md](07-server.md)).

`startWatcher` resolves once every tree is being watched for real. **The
guarantee is the walk's**: it takes its baseline before it reports anything, and
a change made before that baseline exists would be part of it rather than a
change. A selected recursive watch has nothing to prepare, and its `ready` is already
resolved. On Linux and on the macOS directory-watch path, `ready` resolves once the first listing of
the tree has taken every directory's watch ([One watch per directory on
Linux](#one-watch-per-directory-on-linux)), so no directory is still unwatched.
Neither covers the moment between taking a watch and its first delivery — Bun
arms a moment after `watch` returns — and nothing can: arming a repository's watch
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
a watcher is something a server owns, and the server's socket decides how long
the process runs; otherwise a finished test would hang on a watcher it forgot.

The walk of `src/core/watcher/tree.ts` is not part of that promise: its `tick`
can be in flight when `close` returns. It reads and writes nothing into the data
directory, so it changes nothing about what the guarantee says.

A rescan that fails is handed to `onError` and dropped: the queue stays usable,
and an `onError` that throws is caught too, because reporting a failure must not
become one.

`watcher.served(name, review, comments)` returns a token for exactly that document.
`watcher.follow(name, token)` consumes it when the matching stream subscribes and
registers its baseline for the first followed burst. `watcher.left(name)` drops a
consumed baseline when the last window leaves; it cannot erase another pending
document token ([Events](#events), where the followed sessions are).

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

One watch per repository, plus one over the data directory. Windows uses
`fs.watch` with `recursive: true` where the runtime honours it. Linux uses
one non-recursive `fs.watch` per directory. On macOS a lifecycle probe selects
the recursive watch when it reports a file in a directory created after root
delivery; otherwise the tree takes one watch per directory itself ([One watch per directory on
Linux](#one-watch-per-directory-on-linux)); where neither is there, the same
interface walks the tree on a timer and compares modification time, size, inode
and change time. Symbolic links are
entries too: the walk compares their target strings using `lstat` and `readlink`,
including dangling links. It never follows a link into a target directory or
reads target content, so changing an outside target alone produces no change.
The explicitly named root may itself be a link. Below that root, directory
components are checked with `lstat` before watching, listing and reporting their
entries; a watched directory replaced by a link loses its descendant watches.
A listing keeps the watch it started on: stale work cannot close its replacement.
An entry removed and restored between checks is not detected by that check. A watch that **dies after it started** says so once,
through `onFallback`. A session that **walks from the start** says so once too,
through `onWalk`: the probe below found no supported native path, or
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
session walks and why updates are slower.

`recursive: false` skips the question and walks: a filesystem whose
notifications cannot be trusted — a network mount — is what it is for, and so is
a runtime whose watch goes quiet. It says nothing through `onWalk`: the walk is
the caller's own choice, and a line about it would tell the operator what they
asked for.

Accepting `recursive: true` is not the same as honouring it — a runtime that
takes the option and watches only the top directory would leave a silent dead
watcher — so the answer comes from a probe rather than from a version table: `supportsRecursiveWatch(dataDir)`
creates a temporary directory inside the data directory, watches it with the
recursive watch on macOS and Windows, or the directory watches on Linux. It
first repeats a root-file write every fifty milliseconds until delivery is
proven, then synchronously creates two nested directories and their file in one
burst. That file is written only once: repeating it would hide loss of the
initial creation event. Delivery proves the lifecycle case; the whole probe has a half-second
deadline. A false Linux or macOS result still tries native directory watches,
whose own refusal can select polling. An injected native adapter remains independent when
`recursive: true` is supplied. Writing once is not enough — Bun's watch arms a moment
after `watch` returns, and a single write lands before it does, which would
answer "this runtime cannot recurse" for the rest of the run. It runs once per
process — the answer is a property of the runtime, not of a directory — and no
reviewed repository is touched by it. Every write it makes is caught: a disk
that fills between the `mkdir` and the write answers "no" at once instead of
ending the process, because the probe's contract is a boolean and never a
throw, and its one caller has no error path. Its timeout, unlike the watcher's
own timers, is not `unref`'d: while the probe waits it is the only thing holding
the event loop, and a process that exited there would exit before the server it is
starting ever listened. Measured with that probe: Node 25.2
and Bun 1.3 on macOS reported an initial nested path relative to the
watched directory; that measurement did not cover a directory created later.
Node 22.22 and Bun 1.3.14 on Linux reported that initial path with the watch
per directory; the watch and the walk alike hand paths over with forward
slashes on every platform. A watch that fails after it started — an error from inotify or
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
every repository it writes into and the data-directory tree before it measures anything: a
`no diff-changed within 20000 ms` there was never a slow machine, it was a write
nobody was listening for.

**The main watcher suite deliberately polls under Bun's Vitest runner.**
Earlier Bun 1.3 measurements under Vitest saw native watches go quiet after
initial events, so `tests/watcher.test.ts` keeps its suite watcher on polling
under Bun and native watching under Node. It passes `recursive: true` with
`native: spiedTree`, which chooses that source and records its paths
([What the unit tests hold](#what-the-unit-tests-hold)). The suite watcher does
not ask `supportsRecursiveWatch`; the dedicated capability case checks both
possible selections. Native fault-injection cases force `recursive: true` and
assert registration before failing their stub, so a real false probe cannot
bypass the stub. Dedicated native tree and rename-save cases keep their native
assertions on both runtimes, including zero startup walks and zero takeovers.

Earlier server measurements of four consecutive edits under Bun each produced
an event. They covered edits in existing directories, not the new-directory
lifecycle failure described in the native tests section.

macOS coalesces the changes of one directory into a single notification, and a
runtime is free to report any of the names involved: Node reports the file, Bun
reports one of them and sometimes only the directory. That is why a change in
the data directory is one signal rather than a name to match — see below — and
why `.git` itself counts, not only `.git/HEAD`.

Inside a repository these are left out:

| Left out | Why |
|---|---|
| everything under `.git` except `HEAD`, `index`, their `.lock`, and the files of `info/` | the first two move when the base of the change set does, and `info/exclude` holds ignore rules; the rest is git's own bookkeeping. The locks and the rest of `info/` are there because Bun names a rename by its source ([One watch per directory on Linux](#one-watch-per-directory-on-linux)). `.git` itself is not left out: a runtime that reports the directory rather than the file inside it would otherwise never say that HEAD moved |
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
A whole-file write is a temporary file and a rename over the target, and the
runtimes differ in which name they report: Node the file — on Linux the
temporary one before it — Bun the temporary one, and Bun under a test runner
only the directory the change was under. The lock
is deliberately not left out: it is not data, but a runtime that coalesces the
changes of one directory into one notification — macOS does, and Bun reports
what is left — can hand the lock back as the only name of a write that changed a
session's files.
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

### One watch per directory on Linux

inotify does not recurse. A watch is set on one inode, and a directory's watch
reports, by name, the entries that change inside it. So `recursive: true` on
Linux is always an emulation, and Node 22's emulation loses a file replaced by
rename after the first time. Its `lib/internal/fs/recursive_watch.js`
takes a watch per path, files included, each on the inode that was there when
the watch was taken. A rename over a file gives the name a new inode. The watch
on the old one fires once and then watches nothing, and the directory's own
event is read back through a listing that reports only names the emulation has
not seen before, which the replaced name is not.

git replaces `.git/index` and `.git/HEAD` exactly that way, renaming
`index.lock` and `HEAD.lock` over them, and `writeFileAtomic` replaces every
file of the data directory the same way. Measured at `f7b57b8`, the commit
before the fix, on Node 22.22.2 with `serve` on the small synthetic review:
three `git add -f` in a row produced one `diff-changed`, and four moves of
`HEAD` by `git symbolic-ref` produced one. A bare recursive watch heard the
first and none of the rest of each of these: three index moves by `git add`
and `git rm --cached`, three checkouts, three `writeFileAtomic` and three
`updateComments` of `comments.json` from another process, and three of a
shell's `printf > tmp && mv tmp comments.json`. The
release branches v22.x, v24.x and v25.x of Node still carry that code. Node's
`main`, read on 2026-09-29, has moved Linux to one watch per directory for the
same reason, and that is not in a release `engines` accepts.

Linux always takes one non-recursive watch per directory. macOS takes directory
watches when the recursive lifecycle probe fails. A directory adapter selected
explicitly on macOS uses recursive registrations only when that same measurement
proved them available; descendant names are filtered so each child owns its
events. With a false measurement it keeps non-recursive registrations. The
watched inode is the directory's, which outlives every rename into it.

- **Taking the watches.** It lists the tree once at the start, the way the walk
  does, and prunes what the ignore rules leave out as a directory:
  `node_modules`, `.git` except `info`, the object store of a nested repository.
  Those cost no watch at all, where Node's emulation took one per file inside
  them. `ready` resolves once that listing has taken every watch.
- **Following changes.** A directory's event names the entry, and the tree
  reports it after listing that directory again, to watch a directory that
  appeared and drop the watches of one that went. Each listing also compares
  no-follow file stamps and link target strings with that directory's baseline.
  An ignored temporary name can therefore still report the target replaced by
  its rename. The cost is metadata reads for the files of the listed directory
  and one retained stamp per file; queued listings still share that work. It lists instead of trusting
  the name because Bun reports one name per read of the descriptor: a new
  directory named in the same read as a sibling's write would never be watched.
  A listing asked for while one runs shares the single one queued after it, so
  a directory written into without a pause is listed at most twice at a time.
- **A directory found after the start** reports every file and link entry already
  in it, since they may have been written before its watch existed. A known
  directory whose change time moved is listed too: its parent notification can
  arrive before its own, and a later root marker must wait for those entries.
- **In the order of the writes.** Those files come out of a listing, later
  than an event would carry them. So a name an event carries is reported only
  once every listing and arm the tree had started and not finished when the
  event came has finished, anywhere in the tree, and whatever they find, which
  was written before it, is said first. The listing triggered by that event is
  included. A name never waits for work started after that listing and its
  prerequisite work, so a stream of events cannot starve it. It can wait for a slow listing
  of another directory that was already under way.

  Each piece of work is tracked once, and chained into one promise that an event
  takes as it is, in constant time. `aefc358` copied the set of work under way
  on every event instead, and every event of a stream added one entry to that
  set. A burst of 5000 files in one directory, which libuv delivers in one
  synchronous loop, took 13.0 s, a 7.4 s stall of the event loop and 1406 MB of
  heap on Node, and 20000 files ended the process out of heap. At `956c10a`,
  before file-stamp comparison, 5000 took 1.6 s and 12 MB, and 20000 took
  2.3 s and 10 MB, the same as `ff0dc4b`. Of those 20000 the native events
  named 16384, the kernel's default `max_queued_events`. Snapshot comparison
  also reports entries whose names the native stream omitted.
- **A directory removed and made again under its name** — `rm -rf dist &&
  mkdir dist`, `mv tmp dist`, a `git checkout` between branches that differ
  in `src/gen` — keeps a watch on the directory that is gone, and nothing
  written into the new one would be heard. Two checks catch it, each for a
  case the other cannot see:
  - **By identity, on every listing.** The listing that follows an event
    compares each watched directory it lists with the identity its watch was
    taken on, and one that differs is watched again from scratch. The identity
    is the inode and the birth time, read before the watch is taken, and
    recorded only by the call that took the watch. A second arm of the same
    path read a later directory. The inode alone says nothing: ext4 hands the
    freed inode to the next `mkdir` at once, and `rm -rf dist && mkdir dist`
    gave back the same inode 4 times of 4 on both runtimes, with a birth time
    that differed each time. This is the check that holds under Bun, whose read
    may name only the source of `mv tmp dist`, so no event need name `dist` at
    all.
  - **Only a birth time that is one.** Where `statx` is refused — WSL1, a
    strict seccomp profile, some emulators — libuv reports the change time as
    the birth time. That moves whenever the directory gains or loses an entry,
    so every new file re-armed its directory and reported the subtree again. At
    `aefc358`, under a wrapper that refuses `statx` (the review's `nostatx.c`),
    a save in `src/` and then a root write reported 2002–2003 names a round on
    Node; now 1 or 2. So the tree counts birth times only once it has seen a
    directory whose birth time differs from its change time, which a copy of
    the change time never does, and compares inodes alone until then. This is
    read, not probed: the tree may write nowhere but the data directory, and a
    reviewed tree is not one. No test holds it, since refusing `statx` needs a
    seccomp wrapper the suite does not have.
  - **By a rename event, on both runtimes.** A `rename` event that names a
    watched directory says the name was made or removed, and its watch is
    renewed whatever the identity says. That is what holds where birth times do
    not count, with the inode reused. On Bun it holds whenever Bun's one name of
    the read is the directory's.

  A directory made again is missed only when all four of these hold: the tree
  has not counted birth times (none recorded, or only copies of the change
  time); the new directory got the old inode; no `rename` event named it while
  its old watch was still in the map; and the listing after it found the same
  inode. On ext4 with `statx` the first never holds once any directory of the
  tree has had an entry added after it was made.

  At `26556f5`, where the inode alone decided, a write into the directory made
  again was never heard in 4 of 4 rounds of `rm -rf && mkdir` on either
  runtime, nor after 3 of 3 checkouts; Bun lost the `mv tmp dist` form in 2 to
  4 rounds of 4. Now all are heard (`tests/watch-tree.test.ts`).
- **A directory it may not read** — a volume of mode 700 owned by another user,
  where `fs.watch` refuses with `EACCES` or `EPERM` — is left out, the way the
  walk leaves out a directory it cannot list, and the rest of the tree stays
  watched. At `26556f5` such a directory sent the whole tree to the walk and its
  250 ms interval.
- **Events about a directory itself**, such as a `chmod` or its removal, come
  back from Node under the directory's own name, as `a/a` for `a`. Such a path
  is an ordinary change, and it costs at most one `check-ignore`.

The directory algorithm tests first measure capability in an owned temporary
directory, then select this adapter explicitly. The same native kernel-refusal
seam applies to either registration mode. Default backend selection has its own
new-directory burst and Git rename-save integration checks.

What it costs:

- **Descriptors on Linux.** Every watch of the process shares one inotify descriptor on
  both runtimes: two thousand directory watches opened one descriptor in each.
  The kernel's per-user watch count is spent per directory the rules let in,
  where the emulation spent it per path.
- **The update path.** It adds, per event, one `readdir` of the directory the
  event names and no-follow metadata reads for its file entries. Directory
  identity checks read the named root with `stat` and each component below it
  with `lstat`, before and after listings and before reporting discovered entries.
  A child whose directory change time
  moved is reconciled too. Names wait for this work before being reported.
  The following measurements predate file-stamp comparison and were taken on
  the 4-core container of 2026-09-29, not on the development machine, with nine a side of
  `bun perf/compare.ts` against `f7b57b8`. The gate's server runs on Bun, so
  each run compares Bun's recursive watch with the watch per directory.
  - `26556f5`, 06:08–06:14 UTC, one-minute loads 0.85–3.02: update after an
    edit 313 ms at the base and 297 ms on the branch, −16 ms against ±21 ms,
    `no difference`, as were the other six lines.
  - `ff0dc4b`, 07:08–07:14 UTC, the first run after the container restarted,
    loads 0.67–2.86: 387 against 546 ms, +159 against ±218, `no difference`.
    It resolves nothing. The branch's first five samples ran 546–751 ms and
    its last four 316–409 ms, the base had samples of 719 and 840 ms, and the
    first cold switch took 1244 ms.
  - `ff0dc4b` again at once, warm, 07:14–07:21 UTC, loads 1.63–2.87: 363
    against 343 ms, −20 against ±43, `no difference`, as were the other six
    lines.
  - `aefc358`, where a name waits for the work under way, 07:44–07:50 UTC,
    loads 1.63–3.12: 364 against 362 ms, −2 against ±52, `no difference`, as
    were the other six lines.
  - `956c10a`, where each piece of work is tracked once, 08:28–08:35 UTC, loads
    0.93–3.10: 376 against 343 ms, −33 against ±52, `no difference`, as were
    the other six lines.

  On Node, the latency case of `tests/watcher.test.ts` at `26556f5`, two runs
  a side alternating, read 141.7 and 146.4 ms at the base and 142.8 and
  143.9 ms on the branch.
- **Failure.** A watch that fails hands the tree to the walk, the way a dying
  recursive watch does: `ENOSPC` when the user's inotify watches run out, at
  the start or on a directory made later, or an `error` event on a directory
  that is still there. An `error` on a directory that is gone only drops its
  watches. The root is taken before the tree is returned, so a runtime that
  refuses it walks from the start.

The ways not taken:

- **The walk on Linux** would hear every replacement. It would also add the
  walk's interval to every update, which the 300 ms of `docs/SPEC.md` section 6
  cannot afford.
- **Watching `.git` and `.git/info` beside the recursive watch** would fix git's
  three files. The data directory would still be heard once, and so would any
  working-tree file an editor saves by rename — vim, `sed -i`.
- **Waiting for Node** fixes nothing for Node 22, which `engines` accepts, and
  no release branch has the change yet.

**Bun names a rename by its source.** Both runtimes on Linux now take the same
watches, and Bun still reports one name per read. For git's `index.lock` →
`index`, that name is `.git/index.lock`. For an editor's replacement of
`info/exclude`, it is whatever temporary name the editor wrote. The rule above
used to drop both, and under Bun's own recursive watch, at `f7b57b8`, four
moves of `HEAD` against `bun src/cli/index.ts serve` produced no event at all.
So the rule keeps git's two locks and every file directly in `.git/info`. On a
runtime that names only the lock, the event can come as git creates it, before
the rename. Every read that holds a change is an event, though, and the debounce
restarts on the one that holds the rename, so the rescan comes after it whatever
name that read carries.

**A lock is a change only when its file moved.** git takes `index.lock` for
more than a move of the index. A `git status` without `--no-optional-locks` —
a shell prompt, an editor's poll — takes the lock to refresh the index, and
lets it go without a rename when there is nothing to refresh. Kept as a name,
that lock would cost a rescan per poll, five git processes in the shared queue,
and the repository's kept ignore verdicts. So once a burst's debounce closes,
a burst that names a lock or its file has the file's stamp read — inode, size,
modification and change time — and compared with the stamp the last such burst
of the repository read, or the one the watcher took before its first tree. The
lock stands for its file when the stamp moved, and is dropped when it did not.
A burst left with nothing is no rescan, no signal and no loss of verdicts. The
price is two `stat` calls on a burst that names git's own files.

The stamps a burst read are kept only once its rescan is through. A rescan that
fails leaves the old ones, so the next lock of the same move is still a change,
where keeping the new stamp first would have dropped it as a `git status`. No
test holds this. The suite's one cheap way to fail a rescan is to point
`current` at a task that is not there, and pointing it back makes the watcher
read the whole task again, which would hear the move whatever the stamps said.

**A lock is carried as the file it stands for.** The `files` of `diff-changed`
say `.git/index` or `.git/HEAD`, never the lock. A reader that looks up what
was named finds the lock gone by then, and the symbol index took a name that
was not there for a reason to read the repository whole
([09-ml.md](09-ml.md#the-symbol-index)).

### Editor temporary names

The watcher does not maintain a list of editor names. A directory snapshot
compares the resulting entries even when the only native event names an ignored
source. The editor mechanisms below differ:

| Editor | Names and save behavior |
|---|---|
| JetBrains IDEs, `Safe write` | `file___jb_tmp___` holds the save, `file___jb_old___` holds the previous file, and the temporary file replaces the original ([staff explanation](https://intellij-support.jetbrains.com/hc/en-us/community/posts/115000240484-Cannot-Save-File-when-running-a-watcher)) |
| Emacs, `file-precious-flag` | `file.tmp` plus a generated suffix is renamed over the file; `#file#` auto-save and `.#file` lock names are separate mechanisms ([save implementation](https://github.com/emacs-mirror/emacs/blob/master/lisp/files.el), [auto-save manual](https://www.gnu.org/software/emacs/manual/html_node/emacs/Auto-Save-Files.html)) |
| Vim, `backupcopy=no` | The original is renamed to a backup, whose default suffix is `~`, then a replacement is written. This is a different sequence from renaming a temporary file over the target ([options](https://github.com/vim/vim/blob/master/runtime/doc/options.txt)) |
| VS Code internal state | The state service uses `.vsctmp` for atomic writes. This establishes an internal state-file name, not a universal working-tree buffer-save name ([state service](https://github.com/microsoft/vscode/blob/main/src/vs/platform/state/node/stateService.ts)) |

The native regression simulates an ignored `.tmp` save three times and checks the
target notification and `diff-changed` cache readback each time. It does not
exercise editor executables.

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
| `diff-changed` | `{ repo, files, session }` | a repository was rescanned and its entry is not what it was; `files` are the paths that woke the watcher, not the files of the new change set, and it is **empty** when what woke it was the walk taking over a dead watch, or the read of a session `current` moved to — neither names a path |
| `comment-added` | `{ session, id }` | a comment appeared in the `comments.json` of a followed session |
| `reply-added` | `{ session, id, commentId }` | a reply appeared in a thread; `id` is the reply |
| `comment-status` | `{ session, id }` | a comment was resolved or reopened |
| `session-changed` | `{ name }` | the base, title, name, scope or status of a **followed** session changed |
| `current-changed` | `{ name }` | the `current` pointer moved to this session |
| `sessions-changed` | `{ name, status }` | a review task appeared, changed status, or disappeared (`status: null`) — whichever session it is |
| `warnings` | `{ list }` | the warnings of the change set are not what they were |

The bus is in-process: the server's live stream is one listener and the activity
feed is built from the same events. A listener is called in the order it
subscribed, over a copy of the list, so one that unsubscribes itself while an
event is being delivered — which is what a closing stream does — does not
shorten the list under the loop.

A path covered by a followed named task can lie outside the current task's path
scope. When the current entry stays unchanged, the watcher still invalidates
held documents covering the reported paths and sends a `diff-changed` with that
named `session` only. The scope comes from the existing metadata snapshot and
survives document-cache eviction; unreadable or unknown metadata grants no
notification scope. Current's cache, rescan callback and activity stay unchanged.
A repository control path under `.git/`, or a notification without paths,
applies to the whole repository. Normal path notifications still pass the same
exclude and scope predicates as other live updates.

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
([04-domain.md](04-domain.md)). A session that disappears sends
`sessions-changed` with `status: null`, so a menu already open in another window
removes its row. A window on the deleted task still hears
`session-changed` for it, reads the review again and gets `no-such-session`; a
deleted current session moves `current`, which is `current-changed`, read before
it is followed like any other move.

What the burst does hand over is the listing itself: `onSessions(reviews)`, every
session's `review.json` as the burst read it, after the statuses are compared.
The server's `sessionsRead` compares it with what it holds
([07-server.md](07-server.md)). The watcher keeps no memory of its own for this:
a delete and a `review new` inside one debounce look the same by name, and the
only baseline that tells them apart is the `createdAt` of the document the
server built — which a session created, read and made again before the watcher
first listed it never gave the watcher at all.

**A listing of `reviews/` that fails is not an empty data directory.** The
statuses keep what they knew and `onSessions` is not called: replacing the
snapshot with an empty one would make every session news again on the next
readable burst, and a few hundred of those frames would push the replay out of
the stream's ring ([07-server.md](07-server.md#the-live-stream)). The followed
sessions are still read, one `review.json` each, and go through the same
metadata comparison — skipping them would lose a change that landed in that
burst for good, since the next readable burst would find no difference and say
nothing. Until a listing first succeeds there is no baseline, and the first
readable one becomes it. A session whose `review.json` cannot be read on a burst
keeps the status it had: a file caught mid-write is not a task that changed.

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
  announces nothing. The exception is the first rescan of a repository after
  `current` moves, which reports it here and nowhere else whatever it found: it
  compared with a cache the move's read wrote, which may already hold the edit.
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

**A session entering the set is compared with the exact document its stream
names.** Each review response carries `X-Diffalanche-Document`, an opaque token
for its session metadata, comment snapshot, scope and creation identity. The
snapshot comes from the document passed to serialization, including a cached
body. It is not a fresh read of the files after that body was built.

A stream sending `?served=<token>` consumes that matching task's token once.
Only then does its baseline enter the existing per-task served map. A response
whose window never opens a stream therefore cannot become another window's
baseline. A late disconnect removes only a consumed baseline; an unconsumed
next document stays available for its own stream. When two exact documents are
consumed before the first followed burst, the earlier served document is the
baseline even if its stream subscribes second. Once a task is followed, its
existing comment and metadata snapshots remain the baseline.

Tokens are in memory only, with a limit of 32 unconsumed documents and a 60 s
lifetime. New responses prune expired entries and evict the oldest over the
limit. Consumption removes the token; watcher shutdown clears the registry.
A listing drops tokens for deleted or recreated task identities. Before using
a consumed comment baseline, the watcher checks the task's creation identity
again, so an old document cannot announce a recreated task's history.

An absent, unknown, mismatched, expired, evicted or already consumed token gives
a stream the ordinary silent baseline. A mismatch does not consume another
task's valid token. The page's read after confirmed stream open covers any
read-to-stream gap; there is no document replay log. Comments already in the
document and comments outside its scope are not news. The consumed baseline is
looked up after reading the files, so a document handed over during that read
is not lost. The first followed burst, the task leaving the followed set or
the last stream ending drops that baseline.

The three comment events carry the name of the session their thread belongs to,
so a window can drop what is not its own ([07-server.md](07-server.md)).

A task no window is on is not followed, and a write into its files is no event
at all. What the server holds of such a task is kept honest by `onDataChanged`
instead, which says that the data directory changed and nothing about what
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
while the review response of the server drops them for speed. What the task's
scope leaves of the repository is what goes in (`filterChange`,
[02-git.md](02-git.md)): a repository the task is not about comes back empty and
drops out of the cache, the way a repository without changes does.

The cache is read, compared and written under the session's lock: the CLI writes
the same directory, and a rescan that read the cache outside the lock would
overwrite what the CLI wrote in between.

With no cache at all — or with one computed against a base that is no longer the
session's, or for another scope, which answers a different question — there is
nothing to patch, and a cache holding the one repository
that changed would be read as a review of one repository, so the whole change
set is read instead, by `scanReview` of
[`src/core/change-set.ts`](../../src/core/change-set.ts). That read happens
outside the session lock, which is taken only for the write: it takes as long as
every repository takes, and the CLI writes the same directory meanwhile. A patched cache
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
update. The performance gate measures and enforces that path — an edit of one
file to the page holding that repository's new diff; an over-budget update
fails the gate. The render of the patched diff belongs in the same 300 ms
budget and in the UI live-update path ([11-perf.md](11-perf.md)). What
`tests/watcher.test.ts` measures is the part that belongs here — the file
write, the debounce, the rescan, and the
event — over three edits, and it asserts **300 ms on the median of each edit
less one rescan of the same repository timed beside it**, once the watcher's own
write of that edit has landed, and only where the tree is watched: on the walk
the number is the interval and the cost of the walk itself. The rescan is timed
per edit rather than once after all three because a baseline taken twenty
seconds later is not "the same conditions": a load spike over the edits and not
over the baseline failed an unchanged tree, and the reverse widened the ceiling
without a word ([11-perf.md](11-perf.md#waits-in-the-suites)). That is the watcher's own share, because the rescan costs what the
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

## What the unit tests hold

`tests/watcher.test.ts` measures the watcher on a fixture of its own, and its
helpers carry rules a reader of a red run needs.

**`arm` proves a watch is delivering before anything is measured against it.** A
watch is not live when it returns
([What it watches, and what it ignores](#what-it-watches-and-what-it-ignores)): a
write made before the first delivery is lost outright rather than delayed. So
`arm` repeats the write rather than waiting longer for one — what is waited out
is a lost write, and no ceiling brings one back — and it does so per repository,
because each tree is its own watch. A watcher a test starts itself is not the
suite's, so the suite's `arm` says nothing about it: the signal tests arm their
own, and the data directory's watch is armed too, since on the native path its
`ready` is `Promise.resolve()`, which says nothing about when the OS starts
delivering.

**The probe file's removal is waited for by its own event, never by a sleep.**
Taking the file away changes the repository's change set back, so it produces a
`diff-changed` of its own, and that event is the only proof it has been through
the queue. A fixed pause there was wrong in the way `settle` exists to avoid: a
machine slow enough to deliver the removal late handed the *next* test an event
for the repository armed last. Measured on `main` as one red run in six — the
first test received `repos/platform/loads-search` where it expected
`repos/core/cargos-api`, 21 ms in, which is an event arriving early for somebody
else rather than one arriving late.

**`settle` proves that every write before it is through, on the watch and on the
walk alike.** A test that expects *no* event needs the watcher to be finished
with what the test wrote, and a sleep only guesses when that is. Rescans run in
one queue, so an event queued behind the burst under test is the proof — but
only once that burst exists. On the native path the order of delivery gives that
for nothing; on the walk each tree has a timer of its own, and a write into
another repository can be walked, debounced and rescanned before the walk of the
repository under test has seen the write made just before it. Earlier `settle`
wrote only into the other repository and awaited that event; it held on Node
and not on Bun. In an instrumented copy it
returned before the preceding burst of the repository under test had started its
rescan in 4 of 5 Bun runs and 0 of 3 Node runs, and with the rules of the two
ignore cases pointed at a directory the burst was not in, the `.gitignore` case
still passed in 2 of 4 Bun runs and the `.git/info/exclude` case in 4 of 4. It
now goes in three steps.

1. **The trees have reported everything written before it.** `settle` writes an
   empty `marker-N` at the root of the repository under test and of the data
   directory, and waits until each tree has *reported* it. The suite hands every
   tree to `startWatcher` through its `native` seam, as `spiedTree`: the same
   `watchTree` — the watch on Node, the walk on Bun — with each path it reports
   recorded on its way to the watcher. A walk reads the root listing before
   anything else, so a walk that reports a file new at the root has seen every
   write made before that file existed. On Linux the tree takes a watch per
   directory ([One watch per directory on
   Linux](#one-watch-per-directory-on-linux)), and all of them share the
   process's one inotify descriptor, so the events of the tree come out in the
   order of the writes. The files of a directory made after the start come out
   of a listing rather than an event, so a name waits for the listings under way
   when its event came. Without that wait, a marker written after `mkdir -p
   nested/clone/.git` was reported before the listing found
   `nested/clone/.git/HEAD`. The late name restarted that repository's
   debounce, its burst was queued behind `settle`'s own, and "wakes for a burst
   from a nested repository's git directory" went red on Node in 5 of about 17
   runs at `ff0dc4b`. Past that report, the tree has nothing left to say about
   anything written earlier.
2. **A burst queued behind theirs.** `settle` writes `settle-N.ts` into the other
   repository and waits for that repository's first `diff-changed` since the
   write, which has to name that file and nothing else. A burst that starts after
   every pending one ends its debounce after theirs, so its rescan is queued
   behind them and its event proves they were decided, rescanned or dropped. An
   event that names anything else is a burst of that repository already under
   way, whose git may have read the new file too and left its own burst nothing
   to announce; `settle` then writes another.
3. **The write behind that event.** The event goes out before `diff.json` is
   written ([The change-set cache](#the-change-set-cache)), so `settle` waits
   until the file has `settle-N.ts`. "reads the whole change set again when
   diff.json is gone" removes that file first thing, and while `settle` returned
   on the event, the write behind it put `diff.json` back a moment after the
   removal: the edit under test was patched into it, and the whole read the test
   is about did not run on Bun — or ran for the burst of the case before it, when
   that burst came late. The `diff-changed` naming `watched-2.ts` that the
   same-bytes case seemed to announce on Bun was that burst: the rewrite was
   rescanned after `settle` had returned and the next test had removed
   `diff.json`, and a rescan with no cache to patch reads the whole change set and
   announces it. A save with the same bytes says nothing on either runtime.

The marker is not a change any test can see. The repository's
`.git/info/exclude` carries `/marker-*` from before the watch starts, and the two
tests that rewrite that file keep the line, so a marker is in no change set, a
burst of markers alone is dropped as ignored, and a burst that carries a marker
beside the path under test is decided by that path. A marker git did not ignore
would be worse than none: a probe that is a change of its own, written into the
repository under test and waited for by its event, lands in the burst of the
path git ignores and makes it a burst that is rescanned — which reads exactly
like the defect the case is there to catch.

With the rules of both ignore cases pointed at `other/`, so that the ignored path
really does wake the watcher, both cases go red at their `toEqual([])` in 4 of 4
Bun runs and 3 of 3 Node runs; so do the two object-store cases once the watch is
made to report `.git/objects`, and the same-bytes case once every rescan is made
to announce, in 2 of 2 on each runtime.

**`waitForChangeOf` waits for the event that names the step's own path.** Any
event of a repository since a mark can be an earlier step's, late: in a traced
Bun run the rescan of `again.ts`, left from an earlier test, satisfied the wait
for a `.gitignore` write, whose own rescan then landed in the next step's window.
So a step waits for an event naming what it wrote — `.gitignore`,
`.git/info/exclude`, `.git/index` for `git add`, the edited file — and it runs
alone, with a `settle` before it: a burst already under way could otherwise read
the write in its own rescan and leave the step's burst nothing to announce. A
cleanup that writes several paths waits with `settle` alone. This is not the
filter `waitFor` refuses, below: the negative cases still read every event of the
repository since their mark, and a stray event fails them.

**`waitFor` does not filter by repository, on purpose.** It returns the first
event of a type since a mark, whichever repository it is about; `changesOf` is
the filtered one, and the difference is not an oversight to tidy up. A caller
that expects an event of its own and receives another repository's fails on the
assertion that follows, naming both — which is how the stray event `arm` used to
leave behind was found: `expected 'repos/platform/loads-search' to be
'repos/core/cargos-api'`. Given a filter, that event would have been skipped in
silence and the test would have caught its own a moment later, green every time
while the watcher handed out somebody else's news. The lack of a filter is what
makes a stray event visible at all, so anything that leaks one is a defect to fix
at its source rather than to hide in the helper.

**`hide` writes a change git sees and the watch does not.** `node_modules` is out
of the watch and no rule of these tests names it, so the file is in the change
set the next rescan of the repository reads. That is what makes "no rescan"
visible at all: an ignored file rescanned on its own finds the change set exactly
as the cache has it and announces nothing either way — which is why the
`.git/objects` case, which had no hidden change, held nothing until `hide`
supplied one. The first rescan of the repository spends the hidden change, so
it is written after the last `settle` before the step it serves: a burst that
`settle` waits out, such as a directory the test has just made, would announce
it first. `reveal` is as
invisible to the watch as `hide`, so a pad a rescan took in stays in `diff.json`
until the repository's next rescan: in the nested-repository case the rescan of
the `HEAD` write takes one in and the rescan of the cleanup's `.gitignore`
removal clears it, and the `.git/objects` case, which lets no rescan happen,
never has one in the cache. A case that reads the repository's entry in
`diff.json` begins with a rescan of its own.

**A file replaced by rename is waited for by its own name, every time it is
replaced.** Two cases hold [One watch per directory on
Linux](#one-watch-per-directory-on-linux).

- **"hears every index move and every HEAD move, not only the first"** replaces
  the index of the suite's repository three times and its `HEAD` four times.
  Each step is waited for by `waitForChangeOf` naming `.git/index` or
  `.git/HEAD`, with a `settle` after it. A move of `HEAD` changes the change set
  because the branch it moves onto is a commit of git's empty tree, which every
  repository resolves without having stored it.
- **"hears a file replaced by rename every time, in .git and in the data
  directory"** does the same on trees of its own: three index moves, two
  checkouts, two replacements of `info/exclude` and three of a data directory's
  `comments.json`. The replacements are a temporary file and `mv` from another
  process. Each step waits for the target's own name among what the tree
  reported after it.

The target's name is what the watch on Node and the walk on Bun both report.
Bun's own watch names the lock, so under Bun's runner these two cases stay on
the walk with the rest of the suite. With the branch's test file on
`f7b57b8`, the base of the fix, both cases went red on Node in 2 of 2 runs, at
the first move the emulation drops: `no diff-changed for repos/core/cargos-api
naming .git/index` and `.git/index was not heard after the step`. On the branch
both were green in the same alternating runs. The first case also asserts that
no event it waited for names a lock. "says nothing about a git status that
takes the index lock and moves nothing" runs `git status` twice to let it
refresh what it will, hides a change, runs it once more and expects no event
through `settle`.

**`tests/watch-tree.test.ts` holds native directory lifecycle behavior.**
On macOS the lifecycle probe chooses recursive or per-directory native watching.
Linux uses directory watches; Windows uses the recursive watch. The directory
algorithm cases select the per-directory adapter explicitly on Linux and macOS,
including the strict 5000-name assertion. A separate new-directory burst case
exercises the default backend after its lifecycle probe. Every case writes a file and waits for its
own name after an `arm` that repeats a write until one is heard.

The earlier per-directory lifecycle measurements in this section were taken
on Linux. On macOS 27 with Bun 1.3.14, the recursive watch reported the new
directory but did not report its file within 20 seconds, both in Vitest and in
a standalone child. The directory watch path avoids that recursive lifecycle
failure while a working recursive backend retains its original path. Native measurements must run where filesystem notifications are
available: the local sandbox suppressed Bun events and made Node emit
`EMFILE`; the same owned fixture delivered events outside it.

- **Directories that come, go and come back:** one made after the start with a
  file already in it, then a later write; `rm -rf && mkdir`, three rounds;
  `mkdir next && rm -rf dist && mv next dist`, three rounds; three checkouts
  between branches that differ in `src/gen`; and a removed directory whose
  siblings stay watched.
- **In the order of the writes:** five rounds of a directory made with a file
  in it, then a file at the root, each expecting the directory's file among
  what was reported before the root's. Against `ff0dc4b`'s `tree.ts` it is red
  on both runtimes.
- **A burst in linear time and memory:** 5000 files written into one directory
  by a process the test waits on, so the kernel queues every event and libuv
  delivers them in one loop. Then a file at the root; everything before it is
  reported by then. Node must have named all 5000, and Bun, which names one
  change per read, at least one. The heap must grow by less than 200 MB on
  both. Against `aefc358`'s `tree.ts` it grew by 1.4 GB on Node and by about
  550 MB on Bun, red on both runtimes; on Bun, which names fewer changes per
  read, that is about 2.7 times the bound, so the case guards Node more than
  Bun.
- **A directory it may not read** runs a helper in a process of its own over a
  tree with a mode-000 directory, and expects a write beside it heard, no walk
  and no `onFallback`. The helper also lists that directory itself and reports
  the refusal, which must be `EACCES`: a child that could read it would prove
  nothing. Root reads such a directory anyway, so as root the helper runs under
  `setpriv --inh-caps=-all --bounding-set=-all`. The case first checks that
  `setpriv` really leaves root unable to list a mode-000 directory, and skips,
  saying why, when it does not.
- **A watch the kernel refuses** replaces `fs.watch` for that file through
  `vi.mock`, and refuses past a count with `ENOSPC`. The count runs out at the
  start in one case and on a directory made later in the other. Each expects the
  walk to take over, `onFallback` once, and a later write heard. These cases
  explicitly select the directory-watch adapter on Linux and macOS.

Not held there: the sharing of one queued listing, which only a burst that
lands during a listing exercises, and no write order makes that deterministic. The
`error` event of a watch, which no runtime here emits on demand, is not held
either.

**What each case holds, measured by taking its code away.** Against
`26556f5`'s `tree.ts`, the file went red on Node in 3 cases — the unreadable
directory, `rm -rf && mkdir`, the checkout — and on Bun in those 3 plus `mv
next dist`. Against `ff0dc4b` with one check removed at a time:

| Removed | Node | Bun |
|---|---|---|
| the comparison by identity on each listing | green | `mv next dist` red |
| the renewal on a `rename` event | green | green |
| both | `rm -rf && mkdir`, `mv next dist` and the checkout red | not run |
| `EACCES` and `EPERM` among the skipped | the unreadable directory red | not run |
| the settling of locks, in `index.ts` (watcher suite) | both lock cases red | not run |

So each check has a case on some runtime that only it covers, except the
renewal on a `rename` event: on ext4 the birth time already tells the
directories apart. It is there for a filesystem that records no birth time, and
no test here has one.

The latency test takes the median of three edits, the way the performance gate
reads its own numbers: one slow run on a busy machine is not a regression
([Budget](#budget)). Each edit writes a file of its own, because a runtime that
coalesces the changes of one file into one event — macOS does, under Bun — would
otherwise answer the second edit with the event of the first.
