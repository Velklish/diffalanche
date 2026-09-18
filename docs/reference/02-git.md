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
  disk, not what the driver would make of it.
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

## The three base modes

`docs/SPEC.md` section 3, decision 4 fixes one mode per review session, resolved
separately in every repository. Every fallback is a warning, so a repository
measured against something other than what was asked for never says so silently.

**`head`** — the working tree against HEAD. `git diff HEAD`, not `git diff`: the
base is HEAD, not the index, so a staged change is part of the review. It
arrives from the diff itself, and `ls-files --others` does not list it, so
nothing is counted twice. A repository with no commits yet warns
`HEAD does not resolve: no commits yet` and is skipped.

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

Statuses are `added`, `deleted`, `modified`, and `renamed`. Copy detection is
not enabled — `git diff` runs without `-C` — and a copy, were one to appear,
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

`ls-files --others` names entries, and an entry is not always a readable file: a
dangling symbolic link, a link to a directory, a file deleted between the
listing and the read. One of those costs a warning and its own line of the
change set, never the whole response:

```
untracked file dangling.ts cannot be read: ENOENT
```

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
- `sameScope(left, right)` is `sameBase` for the other half of the cache's key.
- `findRepositories(config)` is that list on its own, without reading any git:
  what a command checks a `--repo` against before it writes anything.
- `totalsOf(repositories)` counts a set of repositories again, for a caller that
  narrowed one.
- `refreshRepository(config, session, base, repo, scope?)` reads one repository
  again and writes it into the cache in place, so a comment written right after
  an edit anchors to the line that is there now. A cache computed against
  another base, or for another scope, is not patched — `review base` and a scope
  edit put it there, and one full scan repairs it. It re-reads rather than
  comparing the cache against the mtimes of `.git` and the working tree: one
  `git diff` on one repository costs less than walking that tree, and it is
  right in the case a mtime comparison gets wrong — a file saved within the same
  second as the scan. With no cache at all there is nothing to patch, so the
  whole root is scanned once.

## What it does not do yet

- Full-file content for browsing is Phase 2.
- The whole diff of a repository is read into memory as one string before it is
  split, so `maxFileBytes` bounds what is carried, not what is read.
