# 03 · Storage

`src/core/storage` owns the session files and the `current` pointer: it is the
only module that reads or writes them. It holds the on-disk shapes of
`docs/SPEC.md` section 7, the write lock of
[ADR-003](../adr/adr-003-on-disk-format.md), and nothing above them: what a
comment means and when a session is current is the domain
([04-domain.md](04-domain.md)).

`config.json` sits in the same directory but belongs to `src/core/config`,
described under [Config](#config) below; it shares storage's field readers and
its error type, and nothing else. `loadConfig` is the only reader of it:
`src/cli/context.ts` calls it once per command and hands the result to the
server, which takes a `Config` and never opens the file itself.

## The data directory

```
<root>/.diffalanche/            dataDirOf(root); --data-dir, DIFFALANCHE_DATA_DIR, or the
                                user config's dataDir replaces the whole path (06-cli.md)
  config.json                   the configuration, read by src/core/config
  current                       the name of the current session, one line
  reviews/<name>/
    review.json                 metadata and base
    comments.json               the threads
    diff.json                   the change set of the last scan
    .lock/                      present only while a write is in progress
```

**A session name is one path segment.** `sessionDir` and `writeCurrent` refuse
an empty name, `.`, `..`, and anything holding a slash or a backslash: `resolve`
would otherwise leave the data directory, and `../../repos/group/svc` would put
review files inside a reviewed repository — the one thing the tool must never
write to. The domain checks names as well ([04-domain.md](04-domain.md)); the
check is here too because this is the module that touches the file system, and
`current` is hand-editable, so its content reaches these functions directly.

`ensureDataDir(dataDir)` creates the directory and its `reviews/`;
`ensureSessionDir(dataDir, name)` creates one session directory. Every path is
also available on its own: `reviewsDir`, `sessionDir`, `currentPath`,
`reviewPath`, `commentsPath`, `diffCachePath`.

**`current` is one line: the session name and a newline**, and nothing else. The
file is a pointer, so `cat current` answers the question it exists for and an
editor that adds a trailing newline does not change its meaning.
`readCurrent(dataDir)` trims the content and returns `null` for a missing or
blank file; `writeCurrent(dataDir, name)` writes `<name>\n`. The synthetic
review writes it too ([11-perf.md](11-perf.md)).

## Reading and writing

| Function | What it does |
|---|---|
| `readReview(dataDir, name)` | `review.json`, validated; refuses a session that does not exist |
| `writeReview(dataDir, name, review)` | replaces `review.json` whole |
| `readComments(dataDir, name)` | the `comments` array of `comments.json`; `[]` when the file is not there |
| `writeComments(dataDir, name, comments)` | replaces `comments.json` whole |
| `readDiffCache(dataDir, name)` | `diff.json`, or `null` before the first scan |
| `writeDiffCache(dataDir, name, diff)` | replaces `diff.json` whole |
| `readCurrent(dataDir)`, `writeCurrent(dataDir, name)` | the current-session pointer |
| `sessionExists(dataDir, name)` | whether `review.json` is there, whatever is in it |
| `listSessionNames(dataDir)` | `{ names, warnings }` |

Every file is written as JSON with `"version": 2`, two-space indentation, and a
trailing newline — the format the spec asks for so the files stay readable and
diffable by hand.

`listSessionNames` takes the session names from the directory names under
`reviews/`, sorted. A directory without a `review.json` is not a session: it is
left out and named in `warnings`, because a session that disappears from a list
with no explanation looks like a lost session. A directory whose name is not a
session name at all becomes a warning too — one bad entry does not end the
listing.

`sessionExists(dataDir, name)` answers from `review.json` being there, not from
it parsing. A session whose file was broken by hand still exists, and a caller
that treated it as absent would overwrite it.

## Atomic writes

`writeFileAtomic(path, content, options?)` writes a temporary file **in the
target's own directory** — a rename across filesystems is a copy, and a copy is
the torn write this exists to prevent — flushes it with `fsync`, and renames it
over the target. A reader therefore sees either the previous file or the new
one. A write that fails before the rename removes its temporary file and leaves
the target exactly as it was.

Two guarantees live here, and only the first is about readers. The rename is
atomic against a concurrent reader whatever else happens. **Surviving a power
cut is the second**, and it needs the directory entry the rename created to
reach the disk as well as the bytes that entry points at, so the write opens the
containing directory and syncs it after the rename. Without that step the
`fsync` of the temporary file buys nothing on its own: it flushes the data of a
file whose only name is about to be discarded, and a `comment` that exited 0
could be absent after a power loss with the previous `comments.json` still in
the listing.

`options.durable: false` leaves the directory sync out, and two writes ask for
it: `diff.json`, a cache git is the source of truth for and the next scan writes
again, and the lock's `info.json`, which no crash outlives. The choice belongs
to the caller rather than to the function guessing from the path, and the scan
path — measured against the budget table of `docs/SPEC.md` section 6 — pays
nothing for durability it does not need.

What the sync does not close is the drive's own cache. On macOS `fsync(2)` does
not ask the drive to flush it: the manual page says the drive "may not
physically write the data to the platters for quite some time" and points at
`F_FULLFSYNC`, which neither Node nor Bun exposes. So the honest statement is
that a durable write survives the operating system losing power, not the drive.
A platform that refuses to open a directory at all — the hypothesis is Windows,
where the build ships binaries — does not turn a successful write into an error:
the flush is skipped and the write stands, because the rename has already
published it. **A flush that was attempted and failed is a different event**, and
only `EINVAL` and `ENOTSUP` are read as the platform declining it. Everything
else, `EIO` above all, comes back to the caller as a `StorageError` naming the
directory — `/root/.diffalanche/reviews/one: durability flush failed: EIO` — so
it reads like every other refusal of this module and the CLI answers 1 with that
line rather than 2 with a stack. A write whose durability was asked for and did
not happen is what the caller wanted to hear about, and swallowing it would
leave `comment` exiting 0 on the one outcome this section promises against.

## The lock

`withLock(sessionDir, fn, options?)` runs `fn` while holding the session's write
lock and releases it in `finally`, whatever `fn` does.

The lock is the directory `.lock` inside the session directory, created with
`mkdir`: it fails when the directory already exists, which is the atomic
primitive the whole scheme rests on. The holder writes `info.json` into it with
its token, pid, `acquiredAt`, and `expiresAt`.

| Option | Default | What it is |
|---|---|---|
| `timeoutMs` | 30 000 | How long a writer waits before refusing with a `StorageError`, and never less than `staleMs` |
| `staleMs` | 30 000 | How long the holder claims the lock for |

**The wait is floored by the lease**, in the defaults and in whatever a caller
passes: `timeoutMs` below `staleMs` is raised to it. The takeover is the only
way a lock left by a dead holder ever goes away, and it becomes possible at the
holder's `expiresAt` — at most one lease away. A writer that gives up earlier
never reaches it, so with a ten-second wait against a thirty-second lease every
writer arriving in the first twenty seconds after a holder was killed waited the
full ten and then refused, naming a writer that was not there. Two numbers that
have to fit each other are one decision, so the wait is derived from the lease
rather than written beside it, and the floor holds the relation for an explicit
pair too.

`staleMs` is a lease, not a guarantee: a body that runs longer than it can have
the lock taken from it. **Every writing body calls `lock.assertHeld()`
immediately before its write** — the body receives the lock as its argument —
and gets a refusal instead of silently overwriting the work of the writer that
took over. `updateComments` does this after the caller's change and before
either file is written; so do `createSession` and `setBase`
([04-domain.md](04-domain.md)).

A writer that finds the lock taken retries with a backoff of 5 ms doubling to
100 ms until `timeoutMs` runs out. Before each retry it reads `expiresAt`: past
that instant the holder is gone and the lock is taken over, so a process killed
mid-write blocks the next one for `staleMs` and no longer. While a holder is
between its `mkdir` and its `info.json` the file is not there yet, and the
directory's own age plus the default stands in for the deadline.

A writer that does give up says what it read out of the lock — `held by pid 4213
since 2026-09-11T03:28:10.031Z, its lease running to 2026-09-11T03:28:40.031Z;
gave up after 30000 ms` — so a wait that ends in a refusal names the process to
look for and the instant the lock would have become takeable. A claim counts
only whole: a lock with no readable `info.json`, and one whose `info.json` is
missing any of the pid, the acquisition or the deadline, are both reported as
held by a writer that has not claimed it, rather than naming a holder built out
of `undefined`.

**A takeover renames the stale lock aside and deletes the renamed directory**
rather than removing it in place. Removing it in place is not enough: two
writers that find the same stale lock would both remove it, the first would then
create its own, and the second's delayed removal would take that fresh lock
away — two holders and the lost write ADR-003 exists to prevent. A rename is
atomic, so exactly one of the two moves the stale lock aside and the other finds
it gone and tries again.

Reading the lock and moving it are still two steps, so what gets moved may no
longer be the lock that was found stale. The token settles it: after the rename
the moved directory's `info.json` is compared with the one the staleness check
read, and a lock that is not the stale one is renamed straight back.

**The end-to-end guarantee is the rename together with `assertHeld` in every
writer**, not either alone. The rename keeps two takeovers from both winning;
`assertHeld` is what a writer whose lock was taken from it anyway — because its
body outran the lease, or because a takeover or a release could not put its lock
back — finds out from before it writes. A writing body that skips `assertHeld`
is outside the guarantee.

**A release moves the lock aside before it deletes it**, the same way a takeover
does and for the same reason. Reading the token and then removing the directory
at that path are two steps, and `rm` removes whatever is at the path when it
runs rather than the directory the token was read from. A writer whose body
outran the lease reaches its release after another writer has taken the session
over, and a removal in place would take that writer's live lock away — two
holders again, one step later. Renamed aside, the directory the token is read
from is the directory that gets deleted, and a lock that turns out to belong to
somebody else is renamed straight back. `ENOENT` on that rename is the ordinary
case after a takeover — the lock is already gone — and a moved directory with no
`info.json` is deleted, which is the answer the takeover gives to the same state.

An uncontended release therefore costs a rename, a read and a removal where it
used to cost a read and a removal. What it buys in exchange is that the only
window left is the pair of renames: a lock being put back is out of its slot for
that long, and a third writer that creates its own inside that window keeps it,
while the writer whose lock this was learns of it from `assertHeld` before it
writes anything.

That window has a second consequence, and it is a message rather than a lost
write. `assertHeld` reads `info.json` at the path, so a writer that calls it in
the instant its lock is moved aside finds nothing there and is refused with "the
lock was taken over while this write was in progress" — while nothing took it
over and the lock comes straight back. The refusal is on the safe side, which is
the side a check before a write belongs on, but the reason it names is not the
reason it fired.

## Read-modify-write

`updateSession(dataDir, name, change, options?)` is **the one write path of a
session's files**. Under the session's lock it reads what is there, hands the
caller a draft, checks the lock is still ours, and writes back:

```ts
await updateSession(dataDir, "ls-240372", (draft) => {
  draft.comments.push(newComment);
});
```

Reading outside the lock and writing inside it is what loses a reply written in
between, so the read is inside too. The value `change` returns is the value the
call returns.

- `updatedAt` is bumped for the caller: every write to a session's files bumps
  it, and a writer that had to remember would eventually not.
- `assertHeld` is called for the caller as well, right before the write. A
  writer that forgets it is outside the lock's guarantee with nothing saying so,
  so no writer is given the chance to forget.
- `comments.json` is written only when the change asked for `draft.comments`.
  `setBase` never touches them, and rewriting a file nothing changed would wake
  the watcher for nothing.
- Without `options.create` the session has to exist. With it, the session has to
  **not** exist and is created from the metadata given; the check is inside the
  lock, so two creates of one name cannot both pass it.

`updateComments(dataDir, name, update)` is `updateSession` with only the
comments in view. No comment writer of the domain calls it: `addComment`,
`reply`, `resolve`, and `reopen` all go to `updateSession`, because each of them
decides against the scope and the scope lives in `review.json` — read outside
the lock it is the scope of a moment that has passed. For `addComment` a
narrowing landing between the read and the write leaves a comment nothing reads
back; for the other three a widening in that window refused a comment that was
already in scope with `no-such-comment` (DA-67.1)
([04-domain.md](04-domain.md)). Taking the scope from the draft costs no read:
`updateSession` reads `review.json` inside the lock for every write anyway.

The lock options go through as well, which is how the lease is tested: a change
that outruns `staleMs` and has the lock taken from it is refused and writes
nothing.

## Config

`src/core/config` turns `config.json` and the command-line flags into one
`Config` with every path already resolved, so nothing downstream has to know
which value came from where. `loadConfig(overrides, cwd)` is the only entry
point; `configPath(dataDir)` names the file.

| Field | Where it comes from | Default |
|---|---|---|
| `root` | `--root`, resolved against the current directory | the current directory |
| `dataDir` | `--data-dir`, resolved against the current directory | `<root>/.diffalanche` |
| `roots` | `roots` of the file, each entry resolved **against the root** | `["."]`, that is the root itself |
| `depth` | `depth` | `2` |
| `exclude` | `exclude` | `[]` |
| `user` | `user`, else `git config user.name` read in the root, else the operating system user | — |
| `port` | `--port`, else `port` | `4880` |
| `lsp` | `lsp`, a command per language | `{}` |

The two kinds of path are relative to different directories on purpose:
`--root` and `--data-dir` are typed at a shell prompt, so they follow the
current directory, while `roots` is written into a file that travels with the
root and so follows the root.

A missing `config.json` is not an error — the defaults are the configuration.
A present one is validated like every other file of the data directory: `port`
has to be a port, `depth` a whole number of levels, `lsp.<language>` a non-empty
command, and a refusal names the file and the field.

The `user` fallback runs `git config user.name` in the root through the `git`
binary ([ADR-002](../adr/adr-002-stack-and-delivery.md)). Reading a
configuration value writes nothing, and unlike the change-set reader this call
keeps the developer's own git configuration, because that is exactly where the
name lives. The server's address is not configurable: it listens on `127.0.0.1`
(`docs/SPEC.md` section 7).

## Validation and errors

Everything storage refuses is a `StorageError` carrying `file` and `field`:

```
/root/.diffalanche/reviews/one/comments.json: comments[0].severity: expected one of
critical, warning, nit, question, got "urgent"
```

The files are meant to be edited by hand (`docs/SPEC.md` section 3, decision 5),
so a broken one is an ordinary event rather than a crash: the version is checked
first and a file of an unknown version is refused whole, then every field is
checked and nothing half-parsed reaches the caller.

`endLine`, `title`, and `side` may be absent as well as `null` — both read as
`null`, which is what the anchor levels of section 7 mean by an omitted field.

The `base` of `review.json` is the change-set reader's own `BaseSpec`
([02-git.md](02-git.md)): storage parses it, git resolves it, and one name means
one thing on both sides.

**A refused write is a `StorageError` too**, not only a file that will not
parse. `ensureDataDir` and `ensureSessionDir` create their directory through one
helper, and a `mkdir` the filesystem turns down becomes the same error naming
the directory and why:

```
/srv/shared/.diffalanche: could not be created: permission denied
```

The reasons it words are `EACCES` and `EPERM` — permission denied — plus
`EROFS`, `ENOSPC` and `ENOTDIR`. An errno outside that set is rethrown
untouched: storage says what it can name and does not dress up what it cannot,
which is the difference between exit code 1 and exit code 2 in
[06-cli.md](06-cli.md). The same error reaches an HTTP write through
`updateSession`, where it is the `500` `error: "storage"` of
[07-server.md](07-server.md) carrying that same sentence.

**A refused read is one in the same way, for the reasons it can name.** A file
that is not there is an answer, not a refusal — no session, never scanned, no
`current`. Past that, the stat behind `sessionExists` and the reads of
`review.json`, `comments.json`, `diff.json` and `current` word `EACCES` and
`EPERM` — permission denied — and `ENOTDIR`, which is what a file written over
`reviews/<name>` gives every read under it:

```
/root/.diffalanche/reviews/alpha/review.json: could not be read: a file is in the way of one of its parents
```

`EISDIR` — a directory where a file should be — is left out on purpose and
reaches exit code 2 with its stack: it is the case the "exit code 2" verdict of
`tests/cli.test.ts` is written against, and that verdict needs one fault no
layer claims (DA-99.1).

Two reads of the data directory are not covered and rethrow anything but "not
there" untouched: `config.json`, which the configuration reads with its own
`ENOENT`-only rule, and the listing of `reviews/` behind `listSessionNames`. A
file where either directory should be still reaches the person as a raw errno;
that is DA-99.2.

The `scope` of `review.json` is checked for being a scope at all and no further:
a list of entries with a `repo` and, when it has them, a list of `paths`; absent
or `null` is the whole root. An empty list is refused, and so is an empty
`paths` — an entry that shows nothing is not a state, and the way to say "the
whole repository" is to leave `paths` out. A repository named twice is refused
as well: one repository is one entry, and two entries for it would leave "the
whole repository" and "these files" both true of it. Whether a repository is
under the root is not asked here — that needs the scan, and it is the domain's
([04-domain.md](04-domain.md)).

`diff.json` is checked down to its envelope only — `version`, `root`,
`repositories`, `totals` — plus the two fields that say what it is an answer
**to**: `base` and `scope`. Both are part of the cache's key. A cache computed
against another base answers a different question, and so does one computed for
another scope: it holds the repositories and the files of the scope it was read
under, so a scope edit would otherwise leave the review reading the answer to
the question it used to ask ([ADR-010](../adr/adr-010-review-task-scope.md)).
Either field missing altogether is read as "never scanned" — a cache that cannot
say what it answers is no answer. The rest of the shape inside it is the git
reader's contract ([02-git.md](02-git.md)), not storage's.

One more field is checked for being a list when it is there: `rootWarnings`,
the part of `warnings` the walk of the root and the scope produced rather than a
read of one repository. A patch of one repository rebuilds that repository's
warnings from a fresh read, and a fresh read cannot say `worktree of <main>`; the
patch puts the repository's share of `rootWarnings` back instead
([02-git.md](02-git.md)). **A cache without the field is read as it is** — every
reader gets the repositories, the totals and the warnings it holds, so the
sessions list keeps counting a task nobody has opened since, a closed one
included. It is only not *patched*: the two writers that patch one repository
into the cache scan the whole scope instead, and that scan writes the field.

## Schema versions

`SCHEMA_VERSION` is what a write puts in a file; `READABLE_VERSIONS` is what a
read accepts. They are 2 and `[1, 2]`.

A `review.json` or `comments.json` of version 1 predates the scope of a review
task: it is read as a task over the whole root that is still open — which is
what such a session has always meant — and what the caller holds is the current
shape, so the next write puts the file on version 2. A data directory therefore
upgrades itself as it is used, and nothing has to walk it. A version that is
neither of the two is refused whole, before any field of the file is read: a
person wrote what is in these two, and half-reading that is worse than saying
no.

**`diff.json` is not in that list.** A version this build does not know is
discarded and the caller scans again, the same answer a cache with no `base` or
no `scope` gets. It is the one file the tool writes and can write again, and
`docs/SPEC.md` section 7 already says hand edits to it are lost.

**A change of the cache's shape is marked by the cache, not by
`SCHEMA_VERSION`.** `rootWarnings` (DA-80) did not raise the version: the
version is shared, and raising it would have every write of `review.json` and
`comments.json` carry the new number, which every earlier build refuses — a
server of one build and an `npx diffalanche` of another on one data directory
would stop reading each other's comments over a field of the one file either can
write again. The field's own absence is the marker instead, and it marks less
than a missing `base` or `scope` does: a cache without it still answers the
question it records, so it is read as it is and served, and only a patch of one
repository refuses it and scans the scope instead. A cache nobody patches keeps
the old shape until something scans that session — `diff`, a server start on it
as the current session, a window on it as a named task. An earlier build
reading a cache that has the field keeps working and leaves it as it found it,
or drops it, which this build answers the same way.

## What it does not do yet

- Migrating a file in place. Nothing walks the data directory to raise its
  files: a version 1 file is raised by the next write to it, and one nothing
  writes to stays as it is and keeps being read.
- Keeping unknown keys. Parsing is strict against the schema of the version it
  is reading: a key the schema does not name is dropped on the next write, so a
  note added by hand to a comment does not survive the next reply to it. That is
  also what raises a version 1 file — the four fields DA-53 added are filled in
  as it is read, and the write puts them on disk.
- The lock covers one session directory. `current` and `config.json` sit outside
  every session and are written atomically but unlocked; two processes switching
  sessions at the same instant leave one of the two names, never a mixture.
- Nothing writes `config.json`: it is read and never rewritten. Writing it from
  the UI is Phase 2.
