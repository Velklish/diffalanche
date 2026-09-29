# DA-45.3 · Result

**Closed 2026-09-29.** Completed. On Windows, `syncDir` in `src/core/storage/atomic.ts` now returns before it opens the directory, so the directory entry is not flushed there. Windows flushes only a handle opened for writing, and neither Node nor Bun offers a directory handle opened for writing, so the flush could never succeed: every durable write failed with `durability flush failed: EPERM`. Skipping it outright, rather than swallowing `EPERM`, keeps the outcome independent of how either runtime names the refusal. The shipped Windows binary is built with Bun, and CI does not run it on Windows.

What a Windows write guarantees is now written in 03-storage: the file's own flush and the rename. NTFS journals the rename, so after a crash the file is the old one or the new one, never a torn one. A power cut can still bring back the old one after `comment` exited 0. On Linux and macOS nothing changed; `EPERM` there is still a refusal of the file.

**Verification.**
- **CI, Windows.** Velklish/diffalanche#9, job 109246529382: `smoke node on windows-latest` passed end to end for the first time (`smoke: node dist/cli.js passed`). DA-45 records this as its third piece of evidence, with what is still not run on Windows.
- **Unit test.** `tests/storage-atomic.test.ts`: with `process.platform` set to `win32` the directory is not opened and the write finishes; otherwise `EPERM` fails the write. 8 of 8 pass on Node and Bun.
- **Mutation probes.**
  - The first form's platform condition dropped: red.
  - The first form's `EPERM` dropped: red.
  - The final form's early return disabled: red.
- **Local checks.** `lint`, `typecheck` and `check:comments` exit 0.
- **CI, required checks.** Green on the PR. The first run's `acceptance on macos-latest` died downloading Chrome from `cdn.playwright.dev` before any test ran, and passed on the next push.

**Review.** One isolated reviewer: no critical or major findings. Its minor findings, all closed:
- The 03-storage paragraph contradicted itself. It is rewritten: the Windows guarantee is stated, and "the hypothesis is Windows" is dropped.
- The cause was over-hedged. It now cites the `FlushFileBuffers` access requirement, still marked as not run on a Windows machine.
- The `UNSUPPORTED` JSDoc. It is accurate again, since `declined()` is gone.
- A hypothesis: the swallow depended on the runtime reporting `EPERM`. This is closed by skipping the flush outright on Windows.

Also from the review:
- Open errors that silently skip the flush are filed as DA-45.4 (minor).
- A likely next Windows stop, renaming a directory that is held open, is noted in DA-45.

**Documentation in the same pass.** `docs/reference/03-storage.md`, "Atomic writes"; `CHANGELOG.md`, Fixed; `docs/backlog/queue/DA-45-windows-verification.md`.
