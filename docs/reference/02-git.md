# 02 · Git

`src/core/git` reads the change set of the repositories the scanner found
([01-scanner.md](01-scanner.md)). Every call runs the `git` binary through
`node:child_process` and only reads: no index, no working tree, no history is
ever written (`docs/SPEC.md` section 11). `GIT_CONFIG_GLOBAL` and
`GIT_CONFIG_SYSTEM` point at the null device, so a developer's own git
configuration cannot change what the tool reads.

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
| `remote` | which remote to look the base branch up on |
| `symbolic-ref --quiet --short refs/remotes/<remote>/HEAD` | the remote's default branch |
| `merge-base HEAD <branch>` | the base of `branch` mode |
| `diff <base> --no-color --no-ext-diff -U3` | the change set of tracked files |
| `ls-files --others --exclude-standard -z` | untracked files |

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

## What it does not do yet

- Full-file content for browsing is Phase 2, and the cache on disk is DA-8.
- The whole diff of a repository is read into memory as one string before it is
  split, so `maxFileBytes` bounds what is carried, not what is read.
