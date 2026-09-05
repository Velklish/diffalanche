# 02 · Git

`src/core/git.ts` reads the change set of one repository. This is the Phase 0
spike's reader: it exists to put 30 000 real diff lines in front of the UI. The
three base modes, the merge base, and proper patch parsing are DA-7.

## What it does

`readRepositoryChange(root, repoPath)` runs three read-only git commands in the
repository and never writes anything — no index, no working tree, no history:

| Command | Why |
|---|---|
| `git rev-parse --abbrev-ref HEAD` | the branch shown in the repository header |
| `git diff HEAD --no-color --no-ext-diff -U3` | the change set: the working tree against HEAD |
| `git ls-files --others --exclude-standard -z` | untracked files |

`git diff HEAD`, not `git diff`: the base of `head` mode is HEAD, not the index
(`docs/SPEC.md` section 3, decision 4). A staged file is part of the review, and
it arrives from the diff itself — `ls-files --others` does not list it, so
nothing is counted twice. `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are
pointed at the null device, so a developer's own git configuration cannot change
what the tool reads.

Each file of the change set carries its path, the old path when git reports one,
a status, the counts of added and deleted lines, and `patch` — the file's
unified diff exactly as git printed it, `diff --git` header included. The header
is part of it because both candidate diff libraries parse it before the hunks;
a bare hunk list renders nothing ([ADR-008](../adr/adr-008-diff-rendering-verdict.md)).

An untracked file becomes an addition: a synthetic patch with a `new file mode`
header and one hunk of `+` lines. Git itself never reports an untracked file in
a diff — only `git add --intent-to-add` would, and that writes to the index.

A pure rename carries no hunks at all. Its paths exist only in the `diff --git`
line, so that line is where the parser takes them from, and such a file stays in
the change set with status `renamed` and no changed lines.

## What it does not do yet

- Only `head` mode. `branch` and `ref`, the merge base, and the per-repository
  warnings of `docs/SPEC.md` section 3, decision 4 are DA-7.
- Binary files are dropped: an untracked file containing a zero byte is skipped,
  and `Binary files … differ` yields no hunks and falls out of the change set.
- The `diff --git a/old b/new` line is split on the last ` b/`, which a path
  containing that sequence would defeat. Quoted paths with escapes are not
  unquoted.
- The whole diff of a repository is read into memory as one string.
