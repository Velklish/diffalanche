# 02 · Git

`src/core/git` reads the change set of the repositories the scanner found
([01-scanner.md](01-scanner.md)). Every call runs the `git` binary through
`node:child_process` and only reads: no index, no working tree, no history is
ever written (`docs/SPEC.md` section 11).

## What the reader trusts

Neither the repository it reads nor the environment it was started in
([ADR-012](../adr/adr-012-git-trust-model.md)).

- **The environment is built rather than inherited.** `readOnlyEnv` in
  `src/core/git/run.ts` copies `process.env` without a single `GIT_*` key and
  puts back `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at the null device. A
  parent that exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` or
  `GIT_CONFIG_COUNT` — a git hook, `git rebase --exec`, an agent shell — changes
  nothing about what is read, and `cwd` alone says which repository that is.
  `resolveUser` in `src/core/config/index.ts` is the deliberate exception: it
  reads the developer's own `user.name` and does not go through this module.
- **Configuration that names a program is pinned, not read.** Every call carries
  `--no-pager` and the `-c` pins of `INERT_CONFIG` — `core.fsmonitor`,
  `core.hooksPath`, `diff.external`, the editor, ssh, credential and hook keys —
  and `-c` beats every configuration file, `.git/config` of the reviewed
  repository included. The keys whose *name* the repository chooses are read
  from it with `git config --list --name-only -z`, filtered by family —
  `diff.<d>.(textconv|command)`, `filter.<d>.(clean|smudge|process|required)`
  and `merge.<d>.driver` — and pinned to nothing on the diff; `--no-ext-diff`
  and `--no-textconv` close two of those by flag as well. `required` is in the
  list because without it an emptied filter is fatal rather than skipped. The consequence to know about: a repository with
  a filter driver — git-lfs is the common one — is shown the content that is on
  disk, not what the driver would make of it. That read starts beside the base
  resolution and the branch, in one `Promise.all`, so it adds a fifth process to
  a read and no step to its wall-clock path.
- **A command added to this module inherits the answer.** The key-by-key table
  of [ADR-012](../adr/adr-012-git-trust-model.md) says which keys the commands
  below reach and what covers each; a new command is checked against that table.
- **A repository whose configuration cannot be read is not read.** The pins are
  built from that answer, so without it there is nothing to read safely with:
  the repository comes back with `base: null`, no files, and the warning
  `repository configuration could not be read`.

## Reading one repository

```ts
readRepositoryChange(root, repoPath, base = { mode: "head" }, { maxFileBytes?, hunks? })
```

It resolves the base, runs the diff, adds the untracked files, and returns the
repository with its branch, its resolved base, its files, and the warnings the
resolution produced:

| Field | What it is |
|---|---|
| `path` | The repository's id, relative to the root |
| `branch` | The checked-out branch; a detached HEAD gives its abbreviated revision |
| `base` | `{ mode, ref, sha }`, or `null` when the base did not resolve |
| `files` | The change set, sorted by path |
| `warnings` | What the base resolution had to say, in order |

A repository whose base did not resolve comes back with `base: null` and no
files. That is how `ref` mode skips one.

| Command | Why |
|---|---|
| `rev-parse --verify --quiet <rev>^{commit}` | does a name resolve, and to what |
| `rev-parse --abbrev-ref HEAD` | the branch shown in the repository header |
| `rev-parse --short HEAD` | the same header when HEAD is detached |
| `remote` | which remote to look the base branch up on |
| `symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` | the remote's default branch |
| `merge-base HEAD <branch>` | the base of `branch` mode |
| `config --list --name-only -z` | the driver keys the repository defines, to pin them ([ADR-012](../adr/adr-012-git-trust-model.md)) |
| `diff-index -p -M <base> --no-color --no-ext-diff --no-textconv -U3` | the change set of tracked files |
| `ls-files --others --exclude-standard -z` | untracked files |
| `check-ignore --stdin -z` | which of a burst's paths git ignores, for the watcher ([05-watcher.md](05-watcher.md)) |
| `for-each-ref --format=… refs/heads refs/remotes` | the branches of the root, for `src/server/routes/branches.ts` ([07-server.md](07-server.md)) |
| `ls-tree -r -z --full-tree <sha>` | the files of the base revision, for browsing |
| `ls-files -z -s`, `ls-files -z --deleted` | the files on disk the index tracks, less the deleted ones, for browsing |
| `ls-files -z --cached --others --exclude-standard -- :(literal)<path>` | whether a path is one git lists, before the working tree is read |
| `cat-file -s <sha>:<path>`, `cat-file blob <sha>:<path>` | one file at the base revision: its size first, then its bytes |

The change set comes from the **plumbing**, not from `git diff`. The porcelain
refreshes the index on its way out, and a refresh takes `.git/index.lock` and
rewrites `.git/index` — a write to a reviewed repository, which
`docs/SPEC.md` section 11 forbids. What changes is the stat cache rather than
content, so nothing is lost, but the rule is the rule and the race is real: a
`git add` in that repository at the same moment fails on the lock. Measured on
git 2.54.0, against a tracked file whose stat differs and whose content does
not, `git diff <sha>` rewrote the index and
`git diff-index -p -M <sha>` left it byte for byte the same.

`-M` is passed because the plumbing inherits none of the porcelain's defaults
and rename detection is one of them; the output is then byte-identical, checked
over renames, a binary addition and deletion, a mode-only change, a deletion, a
quoted non-ASCII name and a tab-padded one, with the index both clean and
stat-dirty. `-c diff.autoRefreshIndex=false` also stops the write and was
measured doing so, but it keeps the porcelain's implicit defaults, and the
module's rule is that the tool names what it wants
([ADR-012](../adr/adr-012-git-trust-model.md)).

**The guard is about writes, not about the working tree.** `tests/git.test.ts`
snapshots `.git/index` byte for byte, the commit HEAD names and every ref of
every fixture repository, before and after a full read in all three base modes,
and `tests/scope-scan.test.ts` asserts the set of subcommands a scan runs is
exactly `config`, `diff-index`, `ls-files` and `rev-parse`. `git status
--porcelain` was the whole guard before and is blind to each of those: an index
rewrite, a ref update, a commit in a repository that started clean, and a
`git fetch` added to a base resolution, which would reach the network and
rewrite `refs/remotes/*` with every check still green. The fixture's tracked
files are given an old mtime on purpose — a file touched to *now* is racily
clean, git re-hashes it, finds it unchanged and writes nothing, so a guard built
on a plain `touch` is green whatever the code does.

## What a failed git call is

`src/core/git/errors.ts` tells four shapes apart, and by what Node reports rather
than by which helper made the call — the discriminator is the **type** of `code`:

| Failure | Recognised by | Whose fault | What happens |
|---|---|---|---|
| `not-started` | `code` is a string (`ENOENT`, `EAGAIN`, `ENOMEM`), with `syscall: "spawn git"` | the machine | thrown, out past every boundary |
| `exited` | `code` is a number: git ran and returned it | the repository | one warning on that repository |
| `killed` | `code` is `null` and `signal` is set | the machine | thrown, out past every boundary |
| `too-large` | `code` is `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` | the repository | one warning on that repository |

The split is not symmetric on purpose. A git that will not start is the same
answer in every repository under the root, and twenty-one warnings saying so hide
it; a repository whose object store is damaged is one repository, and the other
twenty must still come back. So `readRepositoryChange` catches the repository's
own faults and answers with `base: null`, no files and the warning, the way the
scan answers for a directory it cannot read, and lets the machine's faults
through.

`gitOrNull` is the other half. It exists for a command whose failure is an
answer — an unresolved ref, a missing remote — and only a non-zero **exit** is
such an answer. Before DA-66 it swallowed everything, so a git that could not be
started came back as `null` and became
`HEAD does not resolve: no commits yet`: every repository under the root reported
as having no commits, an empty review, and exit code 0. That warning now means
only what it says.

`diffalanche` prints a `GitError` as one line and exits 1, beside the usage,
domain and storage refusals ([06-cli.md](06-cli.md)).

## The three base modes

`docs/SPEC.md` section 3, decision 4 fixes one mode per review session, resolved
separately in every repository. Every fallback is a warning, so a repository
measured against something other than what was asked for never says so silently.

**`head`** — the working tree against HEAD. The base is HEAD and not the index,
so a staged change is part of the review; it arrives from the diff itself, and
`ls-files --others` does not list it. A repository with no commits yet warns
`HEAD does not resolve: no commits yet` and is skipped.

**One path is one entry.** The two sources can name the same file, and one
operation makes them: `git rm --cached` takes the entry out of the index and
leaves the file on disk, so the diff reports a deletion and `ls-files` reports an
untracked file, both correctly. The change set keeps the diff's **deletion** —
that is what the change is, and for the case this is usually reached by,
`git rm --cached .env` on a secret committed by accident, it is the content
leaving the repository that a reviewer needs to see; listing it a second time as
an addition would say the opposite. The file being still on disk is a warning
rather than a second entry:

```
creds.txt is deleted from the base and still on disk: it was untracked out of it
```

**The qualification to "one path is one entry" is what the entry carries, not
how many there are.** A file that changes type — a tracked file replaced by a
symbolic link — is two patches for one path from the diff alone, because git
cannot write that change as one: it writes a deletion of the old mode and an
addition of the new, adjacent and in that order. The de-duplication above never
sees them, since both come from the same source.

They are joined, and the joined entry carries **both**. This is where the pair
parts company with `git rm --cached`: that one is the same file named twice and
keeping one naming is right, while a type change is two real halves of one
change, and dropping either loses what the reviewer came for — the content that
left, or the link that arrived. For a tracked file replaced by a link to
`/etc/hosts`, the link is the finding and the old content is what says what was
lost; a change set that showed one of them would be showing half a security
review.

So `parseDiff` folds an adjacent deleted-plus-added pair on one path into one
entry: both patches in the order git wrote them, both hunk lists, the additions
and deletions summed, and status **`modified`** — the path is on both sides of
the change, which is what makes `deleted` and `added` each untrue about it.

**When one half is listed without content, the other half's patch is what the
entry carries.** A binary file or one over the size limit, replaced by a link,
gives a deletion with no patch beside an addition with one; taking the omission
for the whole entry would hide the link, which is the one thing the entry exists
to show. So the counts are still summed, the patch and the hunks come from the
half that has them, and the side that could not be shown is said out loud in the
repository's warnings rather than left to be inferred from a card with content on
one side only. That warning comes back from `parseDiff` beside the files — it
returns `{ files, notes }` — and `readRepositoryChange` puts the notes into the
repository's warnings. It is a return value rather than an array the caller
passes in, so no caller can lose it by leaving an argument out: taking the files
means reaching past the notes (DA-76.3). `parseDiff` is exported from
`src/core/index.ts` but not from the package, which ships the CLI alone, so the
change of its return has no caller outside this repository.

```
thing.bin changed type and its old side is binary: only the other side is listed
```

Both halves omitted is the only case where the entry is omitted too. The
condition for joining at all is deliberately narrow:
**only** a deletion beside an addition on the same path is joined, so any other
repeat of a path stays two entries where it can be seen rather than being
silently merged into one nobody diagnosed.

Both patches in one `patch` string is a shape the UI's readers had to learn:
every one of them skipped to the first `@@` and then read to the end, so the
second patch's `--- /dev/null` and `+++ b/…` counted as a deletion and an
addition. They now stop at a `diff --git` line — `measurePatch` and `hiddenLines`
([08-ui.md](08-ui.md)), `splitHunks` and `hasNewLine`, `firstAddedLine`, and
`preview` — and the file card parses every patch of the entry rather than the
first.

Keeping one entry per path is what makes every consumer right at once: the
anchor lookup, the sidebar and the card key all take the first match
(`src/core/domain/anchors.ts`, `src/ui/store.ts`), and the counters add up what
the list holds.

**`branch`** — the working tree against the merge base of HEAD and a branch. The
session may name the branch (`base.branch`, for example `origin/develop`);
otherwise it is the remote default branch, read from
`refs/remotes/<remote>/HEAD` — `origin` when the repository has it, else its
first remote. The fallbacks, in order, each with its warning:

| Situation | Warning | What happens |
|---|---|---|
| the named branch does not resolve | `branch <name> does not resolve, using the remote default branch` | the remote default branch |
| no remote at all | `no remote, reading the working tree against HEAD` | like `head` |
| the remote has no recorded default branch | `<remote> has no default branch recorded, reading the working tree against HEAD` | like `head` |
| HEAD and the branch have no common ancestor | `no merge base of HEAD and <branch>, reading the working tree against HEAD` | like `head` |

The resolved base carries the mode it ended at, so a repository that fell back
to `head` says `mode: "head"` even in a `branch` session.

`refs/remotes/<remote>/HEAD` is written by `git clone`; a repository created with
`git init` and given a remote by hand does not have it, which is the third row of
the table rather than an error.

**`ref`** — an explicit ref. It either resolves to a commit or the repository is
skipped with `ref <name> does not resolve`.

## Files

A file of the change set carries its path, the old path when git reports a
rename, a status, the counts of added and deleted lines, the raw patch, and the
same patch structured:

```json
{
  "path": "src/app.ts",
  "oldPath": null,
  "status": "modified",
  "additions": 3,
  "deletions": 3,
  "patch": "diff --git a/src/app.ts b/src/app.ts\n…",
  "hunks": [
    {
      "header": "@@ -1,6 +1,6 @@",
      "lines": [
        { "type": "context", "content": "const line1 = 1;", "oldLine": 1, "newLine": 1 },
        { "type": "delete", "content": "const line3 = 3;", "oldLine": 3, "newLine": null },
        { "type": "insert", "content": "const line3 = 300;", "oldLine": null, "newLine": 3 }
      ]
    }
  ],
  "omitted": null
}
```

`patch` is the file's unified diff exactly as git printed it, `diff --git` header
included, because that is what the renderer parses
([ADR-008](../adr/adr-008-diff-rendering-verdict.md)). `hunks` is the shape
`diff --json` and `diff.json` use (`docs/SPEC.md` section 7): a header and lines
that carry their number on each side, `null` where the line is missing from that
side.

**`hunks` is off in the review response.** The two are the same diff twice, and
a diff is far more objects as a structure than as one string — the review of
`docs/SPEC.md` section 6 is 30 000 changed lines and their context. The renderer
needs only `patch`, so `src/server/review.ts` reads with `hunks: false` and pays
for one of the two; `diff --json` and the `diff.json` cache ask for the structure
and get it. The scrolling budget is what decides this, and the performance gate
is what enforces it. The counts of added and deleted lines come from the parser
directly, so they are right either way, and `tests/change-set.test.ts` holds the
response to carrying no hunks and non-zero counts.

The structured shape comes from **`gitdiff-parser`**, the parser
`react-diff-view` re-exports as `parseDiff` — the same code, imported from its
own package so that nothing pulls React into the CLI. `docs/SPEC.md` section 11
rules out a diff parser of the project's own, and this is the library's. What
the module writes around it is the split of `git diff` output into one patch per
file, which the parser does not do and the renderer needs.

**The status of a patch with no hunks comes from its header.** A binary file and
a staged empty file are both written without `---` and `+++` lines and without
hunks, so the parser has nothing to tell an addition from a change with and
answers `modify` for all of them. The header is what knows: `new file mode` is an
addition, `deleted file mode` is a deletion, and anything else keeps what the
parser said. The prefix matters — `new mode` is a mode-only change and stays
`modified`, which `tests/git.test.ts` pins from both sides. Only the region above
the first hunk is read, because a `GIT binary patch` payload is arbitrary and a
line-anchored match over the whole patch would be matching against content.

Statuses are `added`, `deleted`, `modified`, and `renamed`. Copy detection is
not enabled — the reader passes `-M` and not `-C` — and a copy, were one to appear,
would be reported as a rename.

## Paths

`path` is the name the file has on disk, which is not the name git writes. A
name needing an escape — anything outside ASCII, a quote, a control character —
is written C-quoted with octal escapes for its bytes, and an unquoted name
holding a space is padded with a tab on the `---` and `+++` lines:

```
diff --git a/sp ace.ts b/sp ace.ts
--- a/sp ace.ts<TAB>
+++ b/sp ace.ts<TAB>
diff --git "a/\321\204\320\260\320\271\320\273.ts" "b/\321\204\320\260\320\271\320\273.ts"
```

Read literally, both come out as a path no file has. That is not a display
problem: `path` is the id a comment anchors to (`docs/SPEC.md` section 7), the
argument of `diff --repo` and `comment --path` (section 8), and what an agent
opens at `<root>/<repo>/<path>`. So the reader takes the paths from the header
itself rather than from the parser, in this order:

| Source | When it is used |
|---|---|
| `---` and `+++` | whenever they are there: one path per line, unambiguous |
| `rename from` and `rename to` | a pure rename, which has no `---` or `+++` |
| the `diff --git` line | a mode change and a binary file, which have neither |

The `diff --git` line is last because `a/P b/P` cannot be split at a ` b/` that
the path itself may contain. It is only reached where both sides are the same
path, so it is split down the middle and the two halves are checked against each
other.

Quoting is undone the way git writes it, `quote_c_style`: `\a \b \f \n \r \t \v \"
\\` and octal escapes, collected as **bytes** and decoded as UTF-8 at the end,
because the escapes are the bytes of the name and not its characters.

`-c core.quotePath=false` is deliberately not used. It would drop the quoting of
non-ASCII names and nothing else: the tab padding stays, a name holding a quote
or a control character is still quoted, and the unquoting code would still have
to be there — one fewer case for it to handle, and one more thing to explain.

## Files listed without content

`omitted` says why a file has no `patch` and no `hunks`:

| `omitted` | When | Counts of added and deleted lines |
|---|---|---|
| `"binary"` | git printed `Binary files … differ` or `GIT binary patch`, or an untracked file holds a zero byte | 0 and 0 |
| `"too-large"` | a **tracked** file's patch is over `maxFileBytes` | kept: the patch was parsed, only not carried |
| `"too-large"` | an **untracked** file is over `maxFileBytes` | 0 and 0: the file is never opened, so there is nothing to count |

The limit defaults to `DEFAULT_MAX_FILE_BYTES`, 512 KiB per file, and is
`maxFileBytes` of the reader's options. For a tracked file it caps what the
change set carries, not what git is asked for. For an untracked one it is
checked against the file's own size before the read, which is the point: a huge
untracked file is never loaded into memory at all. That one check is the whole
decision — the patch built around the file is not measured a second time, or the
header put on it would drop a file that passed.

## Untracked files

An untracked file is an addition. Git itself never reports one in a diff — only
`git add --intent-to-add` would, and that writes to the index — so the reader
builds the patch git would have printed, `new file mode` header and one hunk of
`+` lines, and runs it through the same parser as everything else. Its path is
quoted by the same rule git quotes one — a control character, a quote, a
backslash, `DEL`, or any byte of a non-ASCII character — because `ls-files -z`
hands over names a header cannot hold literally: a tab would be cut short when
the patch is read back, and a newline would tear the patch in two. A file
holding a zero byte is binary and is listed without content; an empty file is an
addition of nothing, with its patch.

**A symbolic link is an addition of mode `120000` whose content is its target**,
which is what git records for a tracked one, so the same link reads the same way
on either side of the index. `lstat` decides what the entry *is* rather than what
it points at, and the target is read with `readlink` and never followed. A link
out of the repository therefore puts its target's *path* in the review and not
its content; a dangling link and a link to a directory are recorded like any
other link rather than refused; and a link to `/dev/zero` is a one-line patch
instead of a read that never returns. The scanner and the watcher already refuse
to follow links ([01-scanner.md](01-scanner.md)), and this is the same rule in
the one place that had departed from it.

One case still costs a warning and its own line of the change set, never the
whole response — `ls-files` named the entry and the reader did not find it:

```
untracked file gone.ts cannot be read: ENOENT
```

The reader also requires a regular file before it reads, because a device
reports a size of zero and would pass any limit. That guard has no test and no
reachable path: `ls-files --others` lists regular files and symbolic links and
nothing else, which was measured rather than assumed. It stays as what keeps the
size check honest.

A `diff --git` block the parser makes nothing of — not known to happen — is
listed as `binary`: the file is real, git printed the header, and while the
reason for having no content is unknown, having none is the part that is true.

## The whole review in one call

`src/core/change-set.ts` puts the scanner and the reader above together, and
everything that needs a whole review goes through it: `diff` in the CLI, the
review service of [07-server.md](07-server.md), and the watcher's rescan.

```ts
const cache = await scanReview(config, review.base, review.scope);
await refreshRepository(config, session, review.base, "repos/group/service-api", review.scope);
```

- `scanReview(config, base, scope?)` finds the repositories of `config.roots` to
  `config.depth`, reads **the ones the scope names** against `base`, drops the
  ones with no files, keeps every warning — a repository whose base did not
  resolve has none of the first and one of the second — and returns the
  `DiffCache` of `docs/SPEC.md` section 7, sorted by path with its totals
  counted. It asks for the structured hunks, because the anchor of a line
  comment is captured from them.
  It comes back as `{ cache, found }`: `found` is every repository the walk saw,
  with changes or without, which is how a caller tells a `--repo` nothing is at
  from a repository that has nothing to show.
- **The walk stays whole and the reading is what the scope narrows**
  ([ADR-010](../adr/adr-010-review-task-scope.md)). Finding a repository is
  reading directories and starts no git process, and it is what tells a
  repository the scope names but the root has not from one that is simply quiet:
  the first gets a warning of its own — `in the scope of this review task, but
  not a repository under the root` — because the entry was checked when it was
  written, so what the warning says is that the repository has gone since.
  Reading one is five git processes, and a task over two repositories of
  twenty-one must not pay for the other nineteen;
  `tests/scope-scan.test.ts` counts the processes rather than the seconds.
- `filterChange(scope, change)` is what the scope leaves of one repository: a
  repository the task is not about comes back with no files and no warnings, one
  the scope holds as a whole keeps every file, and one that names paths keeps
  those and no others. **The names are matched as they are written, a renamed
  file included**: a file whose name changed is at a path the scope does not
  name, and nothing outside the scope is shown
  ([ADR-010](../adr/adr-010-review-task-scope.md)). What the task keeps is the
  path it was given, which now has nothing to show — the answer a file that
  stopped changing gets.
- **The reads are bounded, the walk is not.** `mapWithLimit(items, limit, run)` keeps at most
  `limit` of them in flight and returns results in the order the items were given;
  `SCAN_CONCURRENCY` is 8, and `scanReview` and the server's `summarise` and
  `candidatesOf` all go through it, so how many git processes a scan has in
  flight is decided by the code rather than by how many repositories the folder
  happens to hold (DA-98). Eight because the curve flattens there — the
  synthetic review — its twenty-one repositories and the sibling worktree the
  walk counts beside them, twenty-two reads — medians of three runs:

  | Width | 1 | 2 | 4 | 6 | 8 | 12 | 16 | unbounded |
  |---|---|---|---|---|---|---|---|---|
  | ms | 802 | 404 | 322 | 261 | 270 | 279 | 279 | 275 |

  Past six it buys nothing, and unbounded is not faster than eight. The
  bound itself is asserted in calls, in `tests/change-set.test.ts`, because that
  is the only place it holds whatever the machine is doing. `tests/scope-scan.test.ts`
  reads a peak off a shim that records each real process starting and finishing —
  23 with the bound against 50 without it on a quiet machine — and that one is a
  ceiling rather than a probe: a loaded machine never reaches the peak an
  unbounded scan would need to cross it.
- `sameScope(left, right)` is `sameBase` for the other half of the cache's key.
- `findRepositories(config)` is that list on its own, without reading any git:
  what a command checks a `--repo` against before it writes anything.
- `totalsOf(repositories)` counts a set of repositories again, for a caller that
  narrowed one.
- `refreshRepository(config, session, base, repo, scope?)` reads one repository
  again and writes it into the cache in place with `replaceRepository` below, so
  a comment written right after an edit anchors to the line that is there now.
  A cache computed against another base, or for another scope, is not patched —
  `review base` and a scope edit put it there, and one full scan repairs it. It
  re-reads rather than comparing the cache against the mtimes of `.git` and the
  working tree: one `diff-index` on one repository costs less than walking that
  tree, and it is right in the case a mtime comparison gets wrong — a file saved
  within the same second as the scan. With no cache at all there is nothing to
  patch, so the whole root is scanned once.

### Patching one repository

`replaceRepository(cache, change)` is **the one patch of one repository into
`diff.json`**, and both writers that patch go through it: `refreshRepository`
above, before a line comment captures its anchor, and the watcher's rescan after
an edit ([05-watcher.md](05-watcher.md)). It used to be written twice, and the
two copies had drifted: the CLI's dropped a warning the watcher's kept (DA-80).

- **The entry is replaced.** The repository's old entry goes and the fresh read
  takes its place; a read with no files leaves the repository out, the way a
  scan leaves it out. Every other repository's entry stands.
- **The warnings are rebuilt around it.** What the cache says about every other
  repository stands; what it said about this one is replaced by what the fresh
  read says now **and by the cache's `rootWarnings` for that path**. Those are
  the warnings the walk of the root and the scope produced — `worktree of
  <main>` from [01-scanner.md](01-scanner.md), `in the scope of this review
  task, but not a repository under the root` from `scanReview` — and no read of
  one repository produces them again. Taken from the read alone, a patch drops
  them: a linked worktree stopped being reported after any line comment on it
  until the next full scan. `diff.json` carries them apart from the full list for
  exactly this ([03-storage.md](03-storage.md)).
- **Every list of the cache is sorted where the cache is built, and only
  there**: repositories by path, `warnings` and `rootWarnings` by path and then
  message. A full scan and a patch are built by the same function, so neither
  can write an unsorted list. It matters because both comparisons downstream of
  the `warnings` event — the watcher's `sameWarnings` and the UI store's guard —
  go index by index, and an order-only change reads there as a new set and puts
  a warnings bar the reader dismissed back on the screen.
- **The patch is pure; the lock, the read and the write stay with each
  caller.** Between reading `diff.json` under the session's lock and writing it
  back is where the two writers genuinely differ — the watcher writes nothing for
  a repository whose entry did not change, and hands the new change set over
  before the write; the CLI writes what it patched. Both fall through to a full
  scan when `patchable(cache, base, scope)` says no: the cache answers another
  base or scope, or it was written before `rootWarnings` existed and a patch
  would have nothing to put back. The shared function stops
  at the patch because that is where the copies drifted; taking the lock inside
  it would take a callback for each of those differences.

## Browsing a repository

`src/core/git/browse.ts` reads a repository outside its diff, for browse mode
and for the context `↑ N lines` brings above a hunk ([08-ui.md](08-ui.md)).

`listTree(cwd, sha)` is every file of the repository with where it exists:
`base` from `ls-tree -r` of the resolved base, `worktree` from what the index
tracks less what `ls-files --deleted` names, plus the untracked files the diff
reader already lists. Blobs only — a submodule is a commit in the tree and a
`160000` entry in the index, and there is nothing in it to open — and a
conflicted path the index holds at three stages is one file. Sorted by code
point, like the change set.

`readFileAt(cwd, path, rev)` is one file whole, and every guard is about what
the server could otherwise be made to read:

- **The path is checked before git sees it.** `isRepositoryPath` takes a path as
  the tree lists one — relative, forward slashes, no empty, `.` or `..` segment,
  no backslash, no NUL — and anything else is `null` without a process started.
- **On disk, only a path git lists is read.** `ls-files --cached --others
  --exclude-standard` with the path as a `:(literal)` pathspec has to name it
  back exactly, so an ignored file, anything under `.git`, and a pathspec that
  would match a directory or a glob are all `null`. A tracked file deleted from
  disk is still in the index; `lstat` finds nothing and that is `null` too.
- **A link is read, not followed.** `lstat`, then `readlink`: the text is the
  link's target, which is what git records for a tracked one — and a link that
  points outside the repository has nothing outside read through it.
- **At the base, `cat-file` and not `show`.** The blob as stored, with no
  textconv and no filter; `cat-file -s` first, so a file over the size limit is
  never read into memory.

A file over `DEFAULT_MAX_FILE_BYTES` (512 KiB, the diff's own limit) is
`omitted: "too-large"`, and one with a NUL byte is `omitted: "binary"` — the
same two words, for the same reasons, as a file of the change set
([Files listed without content](#files-listed-without-content)).

## What it does not do yet

- The whole diff of a repository is read into memory as one string before it is
  split, so `maxFileBytes` bounds what is carried, not what is read.
