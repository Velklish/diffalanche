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
<root>/.diffalanche/            dataDirOf(root); --data-dir replaces the whole path
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

Every file is written as JSON with `"version": 1`, two-space indentation, and a
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

`writeFileAtomic(path, content)` writes a temporary file **in the target's own
directory** — a rename across filesystems is a copy, and a copy is the torn
write this exists to prevent — flushes it with `fsync`, and renames it over the
target. A reader therefore sees either the previous file or the new one. A write
that fails before the rename removes its temporary file and leaves the target
exactly as it was.

## The lock

`withLock(sessionDir, fn, options?)` runs `fn` while holding the session's write
lock and releases it in `finally`, whatever `fn` does.

The lock is the directory `.lock` inside the session directory, created with
`mkdir`: it fails when the directory already exists, which is the atomic
primitive the whole scheme rests on. The holder writes `info.json` into it with
its token, pid, `acquiredAt`, and `expiresAt`.

| Option | Default | What it is |
|---|---|---|
| `timeoutMs` | 10 000 | How long a writer waits before refusing with a `StorageError` |
| `staleMs` | 30 000 | How long the holder claims the lock for |

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
body outran the lease, or because a takeover could not put its lock back —
finds out from before it writes. A writing body that skips `assertHeld` is
outside the guarantee.

Release is conditional on the token in `info.json` still being ours. Without
that check a writer whose lock was taken over as stale would delete the lock of
the writer that took it, and hand a third writer the same session at the same
time.

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
comments in view, and is what every comment writer calls.

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

`diff.json` is checked down to its envelope only — `version`, `root`,
`repositories`, `totals`. It is written by a scan and overwritten whole by the
next one, so the shape inside it is the git reader's contract
([02-git.md](02-git.md)), not storage's.

## What it does not do yet

- Migrations between schema versions. Version 1 is the only version there is;
  a version 2 brings the task that migrates to it.
- Keeping unknown keys. Parsing is strict against the version 1 schema: a key
  the schema does not name is dropped on the next write, so a note added by hand
  to a comment does not survive the next reply to it.
- The lock covers one session directory. `current` and `config.json` sit outside
  every session and are written atomically but unlocked; two processes switching
  sessions at the same instant leave one of the two names, never a mixture.
- Nothing writes `config.json`: it is read and never rewritten. Writing it from
  the UI is Phase 2.
