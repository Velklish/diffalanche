# DA-45.3 · The directory flush of every durable write is refused with EPERM on Windows

- **Order:** 355
- **Scope:** [03-storage](../../reference/03-storage.md)
- **Created:** 2026-09-29
- **Dependencies:** none
- **Parent:** DA-45
- **Cost:** major

## Context

Finding discovered while working on DA-45, once DA-45.1 let the Windows smoke past the generator. Velklish/diffalanche#8, job 109236608826:

```
smoke: review new failed
  command    node dist/cli.js review new smoke --title 'smoke scenario' --root /tmp/tmp.i4w23QqXUs/root
  exit code  1
    diffalanche: C:\Users\RUNNER~1\AppData\Local\Temp\tmp.i4w23QqXUs\root\.diffalanche\reviews\smoke: durability flush failed: EPERM
```

`syncDir` in `src/core/storage/atomic.ts` opens the directory, which Windows allows, and its `sync()` fails with `EPERM`. Only `EINVAL` and `ENOTSUP` were read as the platform declining, so every durable write failed on Windows. Assumption, not checked on a Windows machine: Node opens the directory read-only, and Windows flushes only a handle opened for writing.

## Work to do

- On Windows the directory flush is left out before anything is opened; elsewhere `EPERM` stays a refusal of the file.
- 03-storage says what a durable write is on Windows.
- DA-45 notes the next likely Windows stop (a hypothesis from review): renaming a directory that another process holds handles in, as `removeSession` and the lock's move-aside do.

## Out of scope

- The rest of DA-45.

## Verification

- A unit test: with `process.platform` set to `win32` the directory is not opened and the write finishes; otherwise `EPERM` fails it.
- The Windows smoke run gets past `review new`, and whatever it stops on next is recorded in DA-45.
