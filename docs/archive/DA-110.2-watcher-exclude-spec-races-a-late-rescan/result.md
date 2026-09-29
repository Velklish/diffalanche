# DA-110.2 · Result

**Closed 2026-09-29.** Completed, on a cause that differs from the one the card assumed. One write of a rules file is one debounce window, not two. The flake came from the suite's own waits.

**Cause.**
- **`settle` was unsound on the Bun walk.** Each tree is walked on its own timer. `settle` wrote into OTHER_REPO, and that write could be walked, debounced and rescanned before REPO's walk had seen a write made just before it. In the reviewer's logs, a late REPO rescan came after `settle` in 5 of 5 Bun runs and 0 of 3 Node runs.
- **`waitForChangeOf(repo, mark)` took any event after the mark,** including one left over from an earlier step. That is how the rules write's own rescan landed after the next mark on Node too, as in the `check` red of #9. The Bun red of #11 came from the same two causes.
- **Some negative cases checked nothing.** Because `settle` returned early, several of them passed vacuously on Bun: with the rules pointed elsewhere, the `.gitignore` case still passed in 2 of 4 runs and the `.git/info/exclude` case in 4 of 4.

**Fix, in `tests/watcher.test.ts` only; no product code changed.**
- **`settle` has three steps now:**
  1. It writes an empty `marker-N` at the root of the tested repository and of the data directory, and waits until each tree has reported it. A test-only spy, `spiedTree`, records this through `startWatcher`'s existing `native` option. The markers are kept out of change sets by `/marker-*` in `.git/info/exclude`.
  2. It writes a probe into the other repository and waits for the first event that names the probe alone.
  3. It waits until `diff.json` holds the probe.
- **`waitForChangeOf` takes the path it waits for.** Negative assertions still read every event, unfiltered.
- **Cases that could not fail now can.** A hidden change was added where a case could not fail: `.git/objects`, the exclude case. The "diff.json is gone" case was a patch rather than a whole read on Bun, and is fixed.

**Verification.**
- **Full runs.** `tests/watcher.test.ts` passed on Bun in 5 of 5 runs and on Node in 3 of 3, plus 3 of 3 and 2 of 2 under CPU load. The reviewer's own runs were 47 of 47 three times on each runtime.
- **Cost.** The file is about 1.1 s slower on Node and 1.9 s slower on Bun.
- **Mutation probes, each red at the case's `toEqual([])` on both runtimes:**
  - rules pointed at `other/`: 4 of 4 on Bun, 3 of 3 on Node;
  - watch made to report both object stores: 2 of 2 on each;
  - every rescan made to announce: 2 of 2 on each.
- **Checks.** `lint`, `typecheck` and `check:comments` all pass.
- **Review.** Three isolated reviewers:
  - The first rejected an earlier fix by path filtering, with probe logs showing the real cause.
  - The second found the product bug below and four minor doc points, all fixed.
  - The approver read the docs and card fixes.

**Batch entries closed into this task.** DA-60.5, "settle returns on another repository's write": done. `settle` now returns only on an event naming its own probe, after every tree has reported its marker. That is the card's "What it would take".

**Filed.** DA-110.3 (major, queued): on Linux, Node 22's userland recursive `fs.watch` reports a file replaced by a rename only the first time. Reproduced with git: a second `git add`, a second branch switch, and a repeated atomic write are all missed.

**Documentation in the same pass.** `docs/reference/05-watcher.md`, "What the unit tests hold" (`settle`, named waits, `hide` and revealed pads, the suite watcher's path on Bun); `docs/reference/11-perf.md`, "Waits in the suites"; `CHANGELOG.md`, Fixed.
