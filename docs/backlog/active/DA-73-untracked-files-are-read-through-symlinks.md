# DA-73 · Untracked entries are stat'd and read through symbolic links, so a file outside the repository lands in the review and a device link hangs the read

- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

`readUntracked` resolves the entry git named and reads whatever is at the end of
it, without asking whether the entry is a symbolic link or a regular file.

[src/core/git/index.ts:151-157](../../../src/core/git/index.ts):

```ts
const full = join(cwd, path);
try {
  const info = await stat(full);
  if (info.size > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) return listed("too-large");
  const content = await readFile(full);
```

`stat` follows links; there is no `lstat`, no `isFile()`, and no check that the
target stayed inside the repository. The paths come from
[src/core/git/run.ts:96-98](../../../src/core/git/run.ts),
`ls-files --others --exclude-standard -z`, which lists a link like any other
untracked entry.

Reproduced on git 2.39.5 (Apple Git-154) and Node v25.2.1 in a scratch
repository, with `link.txt -> /tmp/da73scratch/out/outside.txt`:

```
$ git ls-files --others --exclude-standard -z | tr '\0' '\n'
link.txt
$ git diff -- link.txt          # what git itself records for the entry
new file mode 120000
+/tmp/da73scratch/out/outside.txt
$ node -e 'stat/readFile through the same path'
stat size 22 isFile true
readFile -> "SECRET-CONTENT-abc123\n"
lstat isSymbolicLink true size 32
```

Git records a link as mode `120000` whose one line is the target *path*. The
reader shows the target's *content* instead, as an added file — which
misrepresents the change set even when the target is harmless, and pulls a file
from outside the repository into `diff.json`, into the UI, and into
`GET /api/review` when it is not.

A second mode of the same omission, reproduced in the same repository with
`zero.txt -> /dev/zero`:

```
stat size 0 isFile false isCharacterDevice true
TIMER: read still not finished after 3s     (exit 3 by watchdog, --max-old-space-size=192)
```

The size limit does not catch it: `stat` reports 0 for a character device, so the
entry passes the check and `readFile` never returns — the scan, and with it
`serve`, stops answering while memory grows.

The rest of the tree already decided this question the other way:
[src/core/scanner/index.ts:80](../../../src/core/scanner/index.ts) — "`isDirectory`
is false for a symbolic link, so links are never followed" — and
[src/core/watcher/tree.ts:170-172](../../../src/core/watcher/tree.ts) — "a link
out of the tree is not part of it". The untracked read is the one place that
departs from that rule, and nothing declares the departure intended:
[tests/git.test.ts:355-368](../../../tests/git.test.ts) covers only a *dangling*
link, which fails at `stat` with `ENOENT` and becomes the documented warning, and
[02-git.md:204-207](../../reference/02-git.md) lists exactly three unreadable
entries — a dangling link, a link to a directory, a file deleted between the
listing and the read. A link to a readable file outside the repository is in
neither. The reach is bounded to untracked entries, so it is a working tree
handed over as a directory or an archive, not one that arrived through git.

## Work to do

- Decide what an untracked symbolic link *is* in a change set, and write it into
  [02-git.md](../../reference/02-git.md) next to the three cases already there.
  The candidates: render it the way git does, as an added file of mode `120000`
  whose content is the target path, which shows the reviewer that a link was
  added; or treat it as an entry that cannot be read and emit the existing
  warning, which is consistent with the scanner and the watcher. The choice
  decides whether `link.txt` appears in the file list or only in `warnings`.
- Make the read use `lstat` and require a regular file before `readFile` runs,
  whichever branch the decision takes. Both failures above die at that one check:
  the link is no longer resolved, and a character device is no longer a
  zero-byte file that passes the size limit.
- Keep the failure local and say what was refused. One bad entry costs a warning
  and its own line, never the response
  ([src/core/git/index.ts:122-127](../../../src/core/git/index.ts)), so the new
  refusal keeps that shape — but `untracked file X cannot be read: ENOENT` is an
  errno today, a link or a device needs a reason that is not one, and the
  reference block quoting the warning has to quote the new wording too.

## Out of scope

- Tracked files. Everything tracked reaches the change set through
  `git diff`, which renders a link as mode `120000` on its own; this task is
  only the `ls-files --others` path.
- The scanner and the watcher, which already do not follow links and are not
  changed by this.
- A reviewed repository's `.git/config` executing commands, which is the other
  way a handed-over working tree acts on the reviewer:
  [DA-61](../../archive/DA-61-git-config-of-a-reviewed-repository-executes/task.md).
- A general timeout around file reads. The device hang is closed here by
  refusing what is not a regular file; whether every read needs a deadline is a
  separate decision and not one this task takes.

## Verification

- A test beside the dangling-link case in
  [tests/git.test.ts:355-368](../../../tests/git.test.ts) builds an untracked
  link to a file outside the fixture repository and asserts the decided outcome —
  the target's content appears nowhere in `change.files`, under any status.
  Reverting `lstat` to `stat` turns it red, which is the mutation probe.
- A second case links to `/dev/zero` and asserts that the read returns rather
  than hanging, under a bound — a regression has to fail with a named timeout,
  not stall the suite.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  Run `bun run perf` as well — `readUntracked` sits inside the per-repository
  read the budgets of section 6 measure, and an extra `lstat` per untracked entry
  is a cost worth seeing, even if a small one.
