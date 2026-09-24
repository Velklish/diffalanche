# DA-99.3 · The embedding index's stat of comments.json rethrows a raw errno

- **Scope:** 03-storage, 09-ml (see [reference](../../reference/README.md))
- **Created:** 2026-09-24
- **Parent:** DA-99.2
- **Cost:** minor

## Evidence

Found by the review of DA-99.2. Storage words `EACCES`, `EPERM` and `ENOTDIR` on
reads of the session files through `readError`, and since DA-99.2 so do
`config.json` and the listing of `reviews/`. The index of the embedding model
takes a fingerprint of each session's `comments.json` with a `stat` of its own
and keeps the `ENOENT`-only shape:

<!-- quote:before:../../../src/core/ml/index/index.ts -->
```ts
  try {
    const info = await stat(commentsPath(dataDir, session));
    return { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
```
<!-- /quote -->

An `EACCES` or `ENOTDIR` there reaches the person as a raw errno at exit code 2.
Not reproduced. The reviewer read it as rarely reachable — the session listing
passes over a session it cannot read before the index gets to it — and that too
is read from the code, not run.

## What it would take

Route the `stat` through storage's `readError`, as `config.json` does, with a
test that makes `comments.json` unreadable under a session the listing still
returns — or, if no such session can reach the index, say so in 09-ml and close
this entry.
