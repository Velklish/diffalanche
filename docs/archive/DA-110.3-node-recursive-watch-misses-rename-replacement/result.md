# DA-110.3 · Result

**Closed 2026-09-29.** Completed.

**Cause.** On Linux, Node 22 builds recursive `fs.watch` in userland (`lib/internal/fs/recursive_watch.js`). It keeps one watch per inode, and a directory event emits only names it has not seen before. So a file replaced by a rename was reported only the first time. `serve` on Node/Linux therefore missed the second `git add`, the second branch switch, and repeated atomic writes to the data directory. Bun has the same class of miss: it names a rename by its source (`.git/index.lock`, `.git/HEAD.lock`, a temporary file), and `repositoryIgnore` dropped those names.

**The watch on Linux.** It now takes one non-recursive `fs.watch` per directory that the ignore rules let in.
- **Why it hears a replacement every time.** A directory's inode outlives every rename into it.
- **Directories that come and go.** It relists a directory on each of its events. A directory found later reports what it already held.
- **A directory made again.** It is recognised by inode plus birth time, where birth times are real. Until one directory's birth time differs from its change time, identity is the inode alone, so a runtime without statx does not re-arm whole subtrees. A rename event that names a watched directory also re-arms it.
- **Unreadable directories.** A directory the server may not read (EACCES, EPERM) is skipped, as the walk skips it.
- **ENOSPC.** It hands the tree to the walk.
- **A root the watch cannot take.** The tree walks from the start.
- **Ordering.** A name waits for the listings already under way when its event came, so the tree reports in write order. That work is tracked once behind one barrier, so a burst of thousands of events stays linear in time and memory.
- **Shared by both runtimes.** Node and Bun both take this watch, and the probe asks it.

**Lock names.** `repositoryIgnore` keeps `.git/index.lock`, `.git/HEAD.lock` and the files directly in `.git/info/`.
- A lock counts only when the stamp of its file moved. The stamp is committed only after that burst's rescan succeeds, so a plain `git status` costs nothing.
- `diff-changed` carries `.git/index` / `.git/HEAD`, never the lock name.

**Verification.** All runs are on the 4-core cloud container, Node 22.22.2 and Bun 1.3.14.
- **Tests.** `tests/watcher.test.ts` and the new `tests/watch-tree.test.ts` pass 61 of 61 on Node and all on Bun. The worker ran them 3 times on each runtime, each reviewer round ran them again, and the approver ran them after the last fix. New cases:
  - every index move and HEAD move;
  - a file replaced by rename in `.git` and in the data directory;
  - a directory made after the start;
  - `rm -rf && mkdir`, `mv next dist`, and a checkout that removes a directory and makes it again;
  - removal;
  - a mode-000 directory under dropped capabilities;
  - ENOSPC at the start and later;
  - a `git status` that moves nothing;
  - write order for a new directory;
  - a 5000-file burst in linear time and memory;
  - a root the watch cannot take.
- **Suites.** `bun run test` and `bun run test:bun`: 11 failed out of 918, all of them the known embedding tests.
- **Checks.** `lint`, `typecheck` and `check:comments` pass.
- **Mutation probes.**
  - Without the per-directory watch: both first new tests red.
  - Identity check removed: the `mv` case red on Bun.
  - Both re-arm rules removed: 3 red.
  - EACCES skip removed: red.
  - Lock settling removed: 2 red.
  - aefc358's quadratic tracking restored: heap +1.4 GB on Node and +550 MB on Bun, red.
  - `take` read as a boolean again: the missing-root case red.
- **Bursts.** Measured with the rv2 probes, 5000 files on Node:
  - HEAD: 1.2–1.6 s, 12 MB;
  - aefc358: 13 s, 1.4 GB;
  - at 20000 files, 16384 names are heard (the kernel queue limit) in 2.2 s and 10 MB.
- **Compare.** `bun perf/compare.ts` against f7b57b8, nine a side, loads 0.93–3.10: every line reads `no difference`. Update after an edit: 376 → 343 ms, ±52.

**Review.** Four isolated reviewer rounds:
1. **Round 1:** one critical, one major, six minor or hypotheses. The critical: a directory made again kept a dead watch, because ext4 reuses the inode, and `git checkout` hits exactly that. The major: EACCES sent the repository to the walk. All were fixed.
2. **Round 2:** one critical, one major, four minor or hypotheses. The critical was quadratic burst tracking, from the worker's own ordering fix. The major: birth time equal to change time without statx. All were fixed.
3. **Round 3:** one major and one minor. The major: a root the watch cannot take no longer walked, because `take`'s new return values are all truthy. The approver fixed both, with a test and a probe.

**Filed.**
- DA-110.4 (major, queued): under Bun, a save through a temporary name that git ignores is not heard. It predates this task.
- DA-110.5 (minor): Bun's test runner may no longer need the walk.

**Documentation in the same pass.** `docs/reference/05-watcher.md`, which gains "One watch per directory on Linux" and changes to the ignore table, the probe, the data-directory naming and "What the unit tests hold"; `CHANGELOG.md`, Fixed.
