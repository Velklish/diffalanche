# DA-76 · A file untracked with git rm --cached appears twice in one repository's change set

- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

A repository's change set is built from two sources, and the untracked entries
are appended without a check against the paths the diff already carries:

```ts
// src/core/git/index.ts:110-119
const [raw, untracked] = await Promise.all([diff(cwd, resolution.base.sha), untrackedFiles(cwd)]);
const files = parseDiff(raw, options);
const warnings = [...resolution.warnings];
for (const path of untracked) {
  const one = await readUntracked(cwd, path, options);
  if ("file" in one) files.push(one.file);
  else warnings.push(one.warning);
}
files.sort((a, b) => byCodePoint(a.path, b.path));
return { path: repoPath, branch: branchName, base: resolution.base, files, warnings };
```

What makes that safe is written down twice — at
[src/core/git/index.ts:130-133](../../../src/core/git/index.ts), "A staged new
file is already in the diff and is not listed here, so the two sources never
count the same file twice", and in
[docs/reference/02-git.md:48-51](../../reference/02-git.md), "It arrives from the
diff itself, and `ls-files --others` does not list it, so nothing is counted
twice". Both are true for a staged new file and false for the reverse operation.
`git rm --cached` removes the index entry and leaves the file on disk, so the
diff reports a deletion (the index no longer has what HEAD has) and `ls-files`
reports an untracked file — both correct, both feeding line 110.

Reproduced on git 2.39.5 (Apple Git-154), in a scratch repository where
`creds.txt` was committed and then `git rm --cached creds.txt` was run:

```
$ git diff HEAD --no-color --no-ext-diff -U3
diff --git a/creds.txt b/creds.txt
deleted file mode 100644
index d97c5ea..0000000
--- a/creds.txt
+++ /dev/null
@@ -1 +0,0 @@
-secret
$ git ls-files --others --exclude-standard -z | tr '\0' '\n'
creds.txt
```

The reader itself, `readRepositoryChange(root, "rmcached", { mode: "head" }, { hunks: true })`,
returns two entries for the one path:

```
{"path":"creds.txt","status":"deleted","add":0,"del":1,"hunks":1}
{"path":"creds.txt","status":"added","add":1,"del":0,"hunks":1}
```

It is not particular to `head`. `git diff <sha>` on the same repository reports
the same deletion, so every base mode sees it.

Two things follow. Totals count one file as two and its lines twice, and the UI
renders it twice under a duplicate React key — the card's key is the repository
path joined to the file path at
[src/ui/components/CentrePanel.tsx:150-152](../../../src/ui/components/CentrePanel.tsx),
and the sidebar row's key is `file.path` at
[src/ui/components/Sidebar.tsx:248](../../../src/ui/components/Sidebar.tsx).
And a comment on it cannot be anchored, because the lookup takes the first
match:

```ts
// src/core/domain/anchors.ts:31
const file = repository.files.find((one) => one.path === path);
```

That first match is the deleted entry, whose single hunk has no new-side lines,
so `nearest` returns null and `captureAnchor([change], "rmcached", "creds.txt", "new", 1)`
throws a message that is not true of the file the reviewer is looking at:

```
rmcached/creds.txt has no hunks in the change set, so line 1 cannot be anchored
```

Nothing downstream removes the duplicate. `filterChange`
([src/core/change-set.ts:106-115](../../../src/core/change-set.ts)) only filters
by scope, and the path-keyed lookups in the UI (`src/ui/store.ts:949` and
`src/ui/store.ts:1383`) take the first match as well.

`git rm --cached .env` on an accidentally committed file, with the file kept on
disk, is the ordinary way this is reached.

## Work to do

- Decide what one path with two entries should become, and record the decision
  rather than picking it in passing. The candidates: keep the diff's deletion
  and drop the untracked entry, which shows the review what the index says;
  keep the untracked addition and drop the deletion, which shows what is on
  disk; or merge them into one entry whose status says the file was untracked
  out of the base, which is a status `FileChange` does not have and which the
  status pill, the counters, the export and the CLI would each have to learn.
- Put the de-duplication where the two sources meet — the loop at
  src/core/git/index.ts:113-117 — rather than in the UI or in `findFile`. Every
  consumer keys by path and takes the first match; making the change set carry
  one entry per path is what makes all of them correct at once.
- Decide whether the case is worth a warning of its own. The file is in two
  states at once and a reviewer reading a single card cannot tell that from the
  card; the reader already has a warnings channel for exactly this kind of
  "listed, but not what you think" entry.
- Correct the invariant where it is asserted: the doc comment at
  src/core/git/index.ts:130-133 and the `head` paragraph of
  [docs/reference/02-git.md](../../reference/02-git.md), which both state that
  the two sources never name the same file.

## Out of scope

- The duplicate React keys as a UI defect. They are a symptom of the change set
  carrying two entries and go away with it; no change under `src/ui` belongs to
  this task.
- The other ways an `ls-files --others` entry is not a plain readable file —
  dangling links, links to directories — and the symlink reading filed as
  [DA-73](../../archive/DA-73-untracked-files-are-read-through-symlinks/task.md).
- The "first match wins" policy of `findFile` and the UI lookups as a general
  question. It is only wrong here because the change set is wrong.
- The wording of the `has no hunks in the change set` message in the general
  case, except where this change makes it reachable for a file that does have a
  hunk.

## Verification

- A git fixture that commits a file, runs `git rm --cached` on it and leaves it
  on disk. `readRepositoryChange` returns exactly one entry for that path, and
  the test is red on the current reader, which returns two.
- The totals of that repository count the file once, and its lines once.
- Anchoring a comment on that file either succeeds or fails with a message that
  is true of the entry the change set carries — "has no hunks" must not be the
  answer for a file whose entry has one.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`,
  and `bun run perf`, since the de-duplication sits in the per-repository read
  that section 6 of `docs/SPEC.md` budgets.
