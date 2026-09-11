# DA-95 · An added or deleted binary file is reported with status modified

- **Order:** 500
- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

A tracked binary file that is added or deleted comes back with `status: "modified"`. The path and `omitted: "binary"` are right; only the status is wrong, and an untracked binary addition is unaffected because [src/core/git/index.ts:143](../../../src/core/git/index.ts) hard-codes `status: "added"` for everything `ls-files --others` names.

The status is taken from the parser and nowhere else:

```ts
// src/core/git/patch.ts:72-75
const status = STATUS[parsed.type];
const oldName = names.old ?? parsed.oldPath;
const newName = names.new ?? parsed.newPath;
const path = status === "deleted" ? oldName : newName;
```

A binary patch has no `---`/`+++` lines and no hunks, so `gitdiff-parser` has nothing to tell an addition from a change and answers `modify`. The `new file mode` / `deleted file mode` line that says which it is sits in the header that `headerPaths` already walks past (patch.ts:164-184) and is never read.

Reproduced on git 2.39.5 (Apple Git-154) in a scratch repository where `gone.png` is deleted and `added.png` is staged new:

```
$ git diff HEAD --no-color --no-ext-diff -U3
diff --git a/added.png b/added.png
new file mode 100644
index 0000000..c5b2898
Binary files /dev/null and b/added.png differ
diff --git a/gone.png b/gone.png
deleted file mode 100644
index 2bd17ab..0000000
Binary files a/gone.png and /dev/null differ

$ bun run.ts            # readRepositoryChange("/tmp", "da-95-probe")
{"path":"added.png","status":"modified","omitted":"binary"}
{"path":"empty.txt","status":"modified","omitted":null}
{"path":"gone.png","status":"modified","omitted":"binary"}
{"path":"run.ts","status":"added","omitted":null}
```

The `empty.txt` line is wider than the title of this task and was not part of what was reported: a **staged empty text file** has no `---`/`+++` lines and no hunks either, so it takes the same route and is also called `modified` — with `omitted: null`, since it is not binary. The parser confirms both shapes directly: `parse("diff --git a/added.png …")` returns `{"type":"modify","hunks":0}`, and so does the header-only patch of the empty file. The cause is therefore not binaries; it is every patch git writes without the two path lines.

One such patch must keep `modified`: a mode-only change, which `tests/git.test.ts:303` pins. Nothing re-derives the status downstream — `src/ui/components/FileCard.tsx:145` reads `CHIPS[file.status]` for the badge — and it is not a documented limitation: [docs/reference/02-git.md:129](../../reference/02-git.md) states the four statuses with no exception, and the binary case in `tests/git.test.ts:277-299` asserts `path`, `omitted`, `patch` and `hunks`, never `status`.

## Work to do

- Derive the status from the header when the parser cannot: `new file mode` means added, `deleted file mode` means deleted, and everything else keeps what `STATUS[parsed.type]` says. Decide where it lives — a second return field from `headerPaths`, which already has the head split into lines, or a separate scan of the same region; the first costs nothing extra per file and the second keeps one function to one job.
- Scan only the region above the first hunk, the way `headerPaths` does. A literal `GIT binary patch` payload is base85 and arbitrary, and a line-anchored match over the whole patch would be matching against file content.
- Decide whether the empty-file case above is closed here or filed on its own. It is the same three lines of fix and a different test; the argument for one task is that both come from the same missing read, the argument for two is that this one is about binaries and was verified as such.
- Keep a mode-only change `modified`. `old mode` / `new mode` is not `new file mode`, so a prefix test is enough, but the existing test at `tests/git.test.ts:303` is what proves it.
- Recheck `path` once the status is right: `path = status === "deleted" ? oldName : newName` now picks a different branch for a deleted binary. Both halves of the `diff --git` line carry the same name there, so the value does not change — confirm that rather than assume it, and check `oldPath`, which stays `null` for anything but a rename.
- Say in [docs/reference/02-git.md](../../reference/02-git.md) how the status of a patch with no hunks is decided, next to the paragraph that lists the four statuses, and add the CHANGELOG line.

## Out of scope

- The missing content of a binary file. `omitted: "binary"` is correct and is what the reference documents; this task changes the status beside it, not the decision to omit.
- Untracked files, whose status does not come from the parser at all. DA-76 covers a file that appears twice after `git rm --cached`, and DA-73 covers reading untracked files through symbolic links.
- Rename and copy detection, and the `STATUS` map's decision to report a copy as a rename.
- The UI badge and the `diff --json` schema, neither of which changes: they read `status` and will simply read a correct one.

## Verification

- A test in `tests/git.test.ts` covers the two cases above — a staged new binary and a deleted binary — and asserts `status: "added"` and `status: "deleted"`. It builds them in a real repository, like the neighbouring cases in that file, so the patch under test is git's own output rather than a hand-written one.
- A mutation probe closes it: committing the test first, then removing the header read, turns that test red while `tests/git.test.ts:303` (mode-only change stays `modified`) stays green. A fix that reaches the mode case would fail the second half.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`. The perf gate is in the list because `headerPaths` runs once per file in the synthetic review and this adds work to it, however little.
