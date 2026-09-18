# DA-99 · An unwritable data directory surfaces as a raw EACCES with a stack trace at exit 2

- **Scope:** 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

Storage wraps everything it refuses on the read path and nothing it refuses when creating a directory. [src/core/storage/index.ts](../../../src/core/storage/index.ts), lines 101-103 and 115-118:

```ts
export async function ensureDataDir(dataDir: string): Promise<string> {
  await mkdir(reviewsDir(dataDir), { recursive: true });
  return dataDir;
}
...
export async function ensureSessionDir(dataDir: string, name: string): Promise<string> {
  const dir = sessionDir(dataDir, name);
  await mkdir(dir, { recursive: true });
  return dir;
}
```

Both let a `NodeJS.ErrnoException` out untouched. Every read in the same module is careful the other way: `readText` (lines 133-141) and `exists` (lines 123-131) translate ENOENT, and `readReview` (lines 150-157) throws `new StorageError(path, null, "no such review session")`. The module states its own rule at the top of [src/core/storage/errors.ts](../../../src/core/storage/errors.ts) — "Everything storage refuses is one error type carrying the file it read or wrote … A message that names neither costs the reader a grep through the data directory" — and [03-storage.md](../../reference/03-storage.md), line 215, repeats it: "Everything storage refuses is a `StorageError` carrying `file` and `field`".

The consequence is the exit code. `run()` in [src/cli/run.ts](../../../src/cli/run.ts), lines 90-104, matches exactly three classes — `UsageError`, `DomainError`, `StorageError` — prints one line and returns 1; everything else prints `error.stack` and returns 2. An errno error is none of the three. [06-cli.md](../../reference/06-cli.md), lines 131-139, documents 2 as "anything the tool did not expect" and says of storage: "a refusal from storage names the file and the field inside it. Both are exit code 1: they are answers, not faults."

Reproduced on this machine with the repository at its current HEAD, a scratch root and a data directory at mode 555:

```
$ bun run src/cli/index.ts review new t1 --root $S/root --data-dir $S/data
Error: EACCES: permission denied, mkdir '…/ro/data/reviews'
    at async ensureSessionDir (…/src/core/storage/index.ts:117:9)
    at async updateSession (…/src/core/storage/index.ts:264:9)
    at async createSession (…/src/core/domain/sessions.ts:122:20)
    at async <anonymous> (…/src/cli/commands/review.ts:120:26)
    at async run (…/src/cli/run.ts:90:18)
EXIT=2
```

The CLI already treats this class of fault as a user error one layer up: `assertDirectory` in [src/cli/context.ts](../../../src/cli/context.ts), lines 29-43, turns EACCES on `--root` or `--data-dir` into a `UsageError`. It does not fire here, because it returns early on ENOENT when `mustExist` is false (line 36) — which is the `--data-dir` case exactly, since the data directory is the one path the tool creates.

Severity is minor: the path is still named in the message, so the reader is not lost, and the trigger is an edge — a read-only mount, a full filesystem, a shared `--data-dir` owned by someone else, a container bind mount. Two things narrow the finder's version. The scenario is the CLI's contract, not ADR-004: [adr-004-agent-contract.md](../../adr/adr-004-agent-contract.md) does not discuss exit codes as a skill interface; the sentence that does is [06-cli.md:3](../../reference/06-cli.md), "its flags, its output, and its exit codes". And the observed frame is `ensureSessionDir`, not `ensureDataDir` — the `review new` path reaches the missing `reviews/` through the session directory first.

## Work to do

- Wrap the two `mkdir` calls so a write refusal becomes a `StorageError` naming the directory and saying what is wrong — permission, no space, read-only filesystem — rather than an errno string. The existing early-return-on-ENOENT shape of `exists` is the model: translate the codes you can name, rethrow the rest.
- Decide how far the wrapping goes and say so where the decision lives. Candidates: only the two `mkdir` calls; every write in storage, which adds `writeFileAtomic` in [src/core/storage/atomic.ts](../../../src/core/storage/atomic.ts) and the `mkdir`/`rename`/`rm` of [src/core/storage/lock.ts](../../../src/core/storage/lock.ts); or a single translation helper the whole module's write path goes through. The wider the choice, the more of the lock protocol's own error handling has to be re-read, because that module distinguishes errno codes deliberately.
- Check that the message survives the server as well as the CLI: `ensureSessionDir` is reached from `updateSession`, so the same refusal answers an HTTP write, and a `StorageError` there should not turn into a 500 with a different text.
- Record in [03-storage.md](../../reference/03-storage.md), next to the "Validation and errors" section, that a refused *write* is a `StorageError` too, which the section currently leaves to be assumed.

## Out of scope

- The `serve` path, where an unreadable data directory ends the process — that is [DA-64](../DA-64-serve-exits-on-unreadable-data/task.md).
- A refused listening socket exiting 2 with a stack trace, which is the same shape of defect in the server and is filed as [DA-71](../DA-71-refused-port-exits-2-with-a-stack/task.md).
- The lock protocol's own semantics: this entry changes how a failure is *reported*, not when a writer waits, retries, or takes a stale lock.
- Making the CLI check writability up front. `assertDirectory` is named above as evidence that the project treats EACCES as a user error, not as the place to fix this.

## Verification

- A test creates a data directory the process cannot write to, runs a write command through `run()`, and asserts exit code 1 with a single line on stderr that begins `diffalanche: ` and names the directory. Reverting the wrapping turns it red, because the uncaught errno error falls through to the `stack` branch and returns 2.
- The test skips rather than fails when it runs as a user for whom mode 555 is not a refusal — root ignores the permission bits, so the assertion would be vacuous rather than wrong.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
