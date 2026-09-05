# 01 · Scanner

`src/core/scanner` finds the repositories of a review. It reads the filesystem
and starts no process, so a scan cannot touch a repository at all — the change
set is read separately by [02-git.md](02-git.md).

## What it does

```ts
scan(root, { roots, depth, exclude }): Promise<{ repositories, warnings }>
```

The walk starts at each entry of `roots` resolved against the root and goes at
most `depth` levels down. A directory holding `.git`, whether a directory or a
file, is a repository; it is **not** descended into, so a submodule or a
worktree nested inside one is never listed (`docs/SPEC.md` section 3, decision
3). A repository is reported by its path relative to the root, with forward
slashes:

| Field | What it is |
|---|---|
| `path` | Path relative to the root: `repos/core/cargos-api`. This is the id the whole tool uses — the `repo` of a comment in `comments.json` is the same string |
| `absolutePath` | The directory itself, as the walk reached it |
| `kind` | `worktree` for a linked worktree, `repo` for everything else |

The result is sorted by `path`, which makes the review order stable between
scans. The `roots` prefix is part of the id: under the fixture's
`roots: ["repos"]` a repository is `repos/core/cargos-api`, and the glossary's
`group/service-api` is the same rule under `roots: ["."]`.

## Worktrees and submodules

`.git` as a directory is an ordinary repository. `.git` as a file holds one
line, `gitdir: <path>`, and two different things write it: a linked worktree
points at `<main>/.git/worktrees/<name>`, a submodule at
`<super>/.git/modules/<name>`. Only the first is a worktree, so only a `gitdir`
with a `worktrees` segment directly under a `.git` gives `kind: "worktree"`; the
main working tree is the directory two levels above that segment. A relative
`gitdir` is resolved against the worktree directory.

A sibling worktree is a repository of its own — the spec says worktrees count —
and when its main repository is also under the root, the scan says so:

```json
{ "path": "repos/core/cargos-api-worktree", "message": "worktree of repos/core/cargos-api" }
```

A worktree of a repository outside the root gets no warning: there is nothing in
the review it duplicates. Matching is done on resolved paths on both sides:
`git worktree add` writes an absolute, already resolved `gitdir`, while the root
a person types may run through a symbolic link — `/var` on macOS is one — and a
hand-written relative `gitdir` resolves against the unresolved directory. Two
paths that name the same repository would otherwise never match.

## What is skipped

- **A directory whose name starts with a dot**, `.git` and the data directory
  `.diffalanche` among them.
- **A symbolic link.** The walk keeps only entries `readdir` reports as
  directories, and a link is not one, so a link to a repository is never
  followed and never listed.
- **A directory matched by `exclude`.** Each glob is matched against the
  directory's own name and against its path relative to the root, so both
  `node_modules` and `repos/legacy/**` do what they look like they do. `**/`
  stands for any number of whole segments, so `**/group` is `group` and
  `a/group` but never `subgroup`; `*` and `?` stay inside one path segment. A
  trailing `/`, the way `.gitignore` spells a directory, is dropped. The
  compiler of those globs, `globToRegExp`, is exported: the watcher applies the
  same patterns to the files inside a repository, so one `exclude` means one
  thing in both places ([05-watcher.md](05-watcher.md)).
- **A directory that cannot be read**, which produces a warning instead:

```json
{ "path": "repos/closed", "message": "directory cannot be read: EACCES" }
```

The subtree below it is lost; the rest of the scan carries on.

## The root itself

A root that is a repository yields an empty review. It is not reported as a
repository — its path relative to itself is empty, and that is no id — and it is
not descended into either, because a found repository is never scanned inside
(`docs/SPEC.md` section 3, decision 3) and the root is not an exception. The
warning says what to do instead:

```json
{
  "path": ".",
  "message": "root is itself a repository; it is not reviewed — put it under a subdirectory or set roots"
}
```

## Warnings

A warning is `{ path, message }`, where `path` is relative to the root and names
the repository or the directory the message is about. The scanner produces the
two above; the base modes of [02-git.md](02-git.md) produce the rest.

## What it does not do yet

- `exclude` is applied to directories only. The walk never looks at files, so a
  glob such as the spec's `**/*.lock` excludes a directory named that way and
  nothing else. Inside a repository the same glob does exclude the file: that is
  the watcher, not the scan ([05-watcher.md](05-watcher.md)).
