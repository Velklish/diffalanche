# DA-90 · writeFileAtomic fsyncs the temporary file and never its directory, so the rename that publishes it is not durable

- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

Every write the tool makes to its data directory goes through one function, and that function
flushes the wrong half of the operation.

[src/core/storage/atomic.ts:16-25](../../../src/core/storage/atomic.ts)

```ts
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
```

The file's bytes are flushed on line 21. The directory entry that `rename` creates on line 25 — the
only thing that makes those bytes reachable under the name a reader looks for — is never flushed:
there is no second `open` of `dirname(path)` followed by `sync()`. `grep -rn "handle.sync\|fsync\|
datasync" src` returns exactly one hit, atomic.ts:21.

The consequence is that `handle.sync()` buys nothing on its own. Flushing the data of a file whose
only name is about to be discarded, and then leaving the rename in the page cache, means a write the
tool has already acknowledged can be absent after a power loss or a kernel panic. Concretely: `da
comment …` returns 0 after `updateSession` wrote review.json and comments.json
(src/core/storage/index.ts:162 and 179); the machine loses power a second later; on remount the
session directory can still list the previous comments.json, and the comment the CLI reported as
written is gone. The other three call sites are the same code — the diff cache
(src/core/storage/index.ts:196), the `current` pointer (index.ts:218), and the lock's own info.json
(src/core/storage/lock.ts:109).

Two things that look like part of this are not, and should not be written into the fix as if they
were.

The documentation is not wrong. [docs/reference/03-storage.md:81-86](../../reference/03-storage.md)
promises only that "a reader therefore sees either the previous file or the new one", and
[ADR-003](../../adr/adr-003-on-disk-format.md) line 20 says only "writing a temporary file and
renaming it over the target". Both hold without a directory fsync, because rename is atomic with
respect to concurrent readers. The torn-read guarantee is intact; the durability gap is the whole
defect.

The leftover temporary file is harmless. A crash between the data write and the rename leaves
`comments.json.tmp-<uuid>` behind, but the session listing skips anything that is not a directory
(src/core/storage/index.ts:341) and the watcher maps `X.tmp-<uuid>` back to `X` before it decides
anything (src/core/watcher/index.ts:710-721). Cleaning that up is not part of this task.

## Work to do

- Add the missing step: after the rename, open the containing directory and `sync()` it, so the new
  entry reaches disk with the data that is already there.
- Decide which writes pay for it before writing the code. The candidates are all five call sites, or
  only the two that hold user-authored state (review.json and comments.json). `diff.json` is a cache
  the scanner rebuilds from git, and the lock's info.json lives for the length of one write; an
  fsync on either is cost with nothing behind it, and the scan path is measured against the budget
  table in [docs/SPEC.md:119-125](../../SPEC.md). If the answer is "not all of them", the choice
  belongs to the caller, not to `writeFileAtomic` guessing from the path.
- Settle the platform question, because a directory handle is not portable. Opening a directory and
  calling `sync()` on it works on this machine under both runtimes — probed on macOS 25.6.0 with
  node v25.2.1 and bun, both printing `dir fsync ok` — but the build ships Windows binaries
  (scripts/build.ts:21-22), and the hypothesis to check is that opening a directory for fsync fails
  there. Whatever the answer, the failure must not turn a successful write into an error: a platform
  that cannot flush a directory should still finish the write.
- Record the narrowed guarantee where the guarantee is stated: the module header at atomic.ts:1-7
  and 03-storage.md:79-86 currently describe only the torn-read property, and after this change they
  should say what durability the write does and does not have. On macOS in particular, `fsync(2)`
  does not ask the drive to flush its cache — the man page says the drive "may not physically write
  the data to the platters for quite some time" and points at `F_FULLFSYNC`, which neither Node nor
  Bun exposes — so the honest statement is that the fix closes the operating-system window and not
  the drive-cache one.

## Out of scope

- Cleaning up leftover `.tmp-<uuid>` files, refuted above as harmless.
- The lock's own timing defects, filed as [DA-89](DA-89-stale-lock-outlives-the-wait.md) and
  [DA-78](DA-78-lock-release-is-not-atomic.md); this entry touches lock.ts:109 only if the decision
  above says that write should be flushed too. Also out: any change to what a reader sees mid-write,
  a property that already holds and must keep holding.

## Verification

- A test asserts the new syscall happens: with `open` stubbed or counted, a `writeFileAtomic` of a
  chosen path opens the containing directory and syncs it after the rename, and removing the call
  turns the test red. A power-loss test is not available in the suites, so this is the check that
  can exist.
- The existing storage tests still pass unchanged, in particular that a failed write leaves the
  target as it was (`await unlink(temp)` at atomic.ts:28) and that a reader never sees a torn file.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` are green, and `bun run
  perf` stays inside the budget table — the scan path writes `diff.json` through this function.
- atomic.ts:1-7 and docs/reference/03-storage.md say what is durable after the change and what is
  not.
