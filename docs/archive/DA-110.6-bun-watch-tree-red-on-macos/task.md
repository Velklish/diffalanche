# DA-110.6 · Under Bun on macOS the directory cases of the watch tree are not heard: test:bun is red on an untouched base

- **Scope:** [05-watcher](../../reference/05-watcher.md#one-watch-per-directory-on-linux)
- **Created:** 2026-10-03
- **Dependencies:** none
- **Parent:** DA-110.3
- **Cost:** major
- **Previous order:** 820
- **Taken:** 2026-11-01


## Execution authorization — 2026-11-01

The owner approved this original item for the current local implementation run, including investigation when labelled hypothesis. Earlier registration-only and per-item-approval wording records the creation boundary; it does not add another approval gate. Preserve original Evidence, AC, Verification and scope. New minor findings are registration only; deferred functions are not included. Independent review and all mandatory checks precede acceptance. No push, release or tag is authorized.

## Context

Finding discovered on 2026-10-03 while the gates of DA-119 ran on the development
machine (macOS 27.0, Bun 1.3.14). DA-110.3 verified `tests/watch-tree.test.ts` on a
Linux cloud container only; on macOS under Bun seven of its eleven cases are red,
and `bun run test:bun`, one of the `gates`, is red on a tree no task has touched.

Measured by the orchestrator in a disposable clone, `env -u FORCE_COLOR
DIFFALANCHE_TEST_RUNTIME=bun bunx --bun vitest run tests/watch-tree.test.ts`:

- on `8236520` (the base of DA-119, code identical to `b5092d2`), twice, load
  averages 40 then 7 at the end: exit 1, `Tests 7 failed | 1 passed | 3 skipped (11)`
  both times;
- on DA-119's branch `230a387` (documentation and tracker only), load 27: exit 1,
  the same seven names.

The seven, all under "a directory that comes, goes and comes back":

- is watched when it is made after the start, with what was already in it
- reports what a new directory held before a name written after it
- reports a burst of thousands of names in one directory in linear time and memory
- is watched again when it is removed and made again under its name
- is watched again when another is moved in over its name
- is watched again after a checkout removed it and made it again
- is let go when it is removed, and the rest of the tree stays watched

Failures are 20 s waits that end unheard, for example
`Error: made/deep/first.ts was not heard` at `heardAfter`
(`tests/watch-tree.test.ts`), and `AssertionError: expected -1 to be greater than or
equal to 0` in the burst case. The worker's own full `test:bun` on `230a387` reported
six of the seven (the first one passed), 922 passed, 3 skipped. Under Node
(`bun run test`) the same file passes on this machine.

Whether `serve` under Bun on macOS misses a directory made after the start, or only
the test's wait does, is not checked.

## Work to do

- Find why Bun's watch on macOS does not hear a directory made after the start, and
  whether the per-directory watch DA-110.3 built for Linux is what macOS takes too.
- Make the cases pass on macOS under Bun, or state the platform where they apply.

## Out of scope

- Linux and Node, where the cases pass.

## Verification

- `env -u FORCE_COLOR bun run test:bun` on macOS reports no failure in
  `tests/watch-tree.test.ts`, three runs in a row.


## Recheck on 2026-10-23

The Backslop 1.0.0 consumer update hit this existing queued issue again. It does
not establish whether the defect belongs to production watching or its test
environment. No watcher implementation, test, deadline, skip or gate was changed.
The earlier measurements above remain historical observations.

Current source: `61cc8b08e372bab2ec07b595898cf7d6114f7526`. Exact initial source before the tool update:
`149f05c54d34eed889b5e639a7b69510ac3b3398`, with its original frozen `bun.lock`
and byte-verified Backslop 0.20.0 payload. The watcher implementation and two
watcher test files are unchanged between these sources.

Host at this recheck: `Darwin 27.0.0 arm64`, Bun `1.3.14`, Node `v25.2.1`. The recorded test
runs used `VITEST_MAX_WORKERS=6`, `DIFFALANCHE_TEST_RUNTIME=bun`, an owned short
`TMPDIR` and separate caches. The temporary directories have since been removed;
create a fresh owned short directory before reproducing.

| Invocation | Source | Exit | Native outcome |
|---|---|---:|---|
| `npx --no-install backslop gates --require-clean --base 149f05c54d34eed889b5e639a7b69510ac3b3398 --json` | current | 1 | 5/8 gates passed, Bun failed, 2 not run after failure |
| `bun run test:bun -- tests/watch-tree.test.ts` | current, first isolated repetition | 1 | 7 failed, 1 passed, 3 skipped |
| `bun run test:bun -- tests/watch-tree.test.ts` | current, second isolated repetition | 1 | 7 failed, 1 passed, 3 skipped |
| `bun run test:bun -- tests/watch-tree.test.ts` | exact initial source and old lock | 1 | same seven failed test names; five assertions identical, two different |

Both current isolated repetitions produced these complete assertions, all under
`tests/watch-tree.test.ts > a directory that comes, goes and comes back`:

| Complete test name within the group | Complete assertion |
|---|---|
| is watched when it is made after the start, with what was already in it | `Error: made/deep/first.ts was not heard` |
| reports what a new directory held before a name written after it | `Error: marker-0 was not heard` |
| reports a burst of thousands of names in one directory in linear time and memory | `Error: marker-after-burst was not heard` |
| is watched again when it is removed and made again under its name | `Error: dist/y-0.js was not heard` |
| is watched again when another is moved in over its name | `Error: dist/y-0.js was not heard` |
| is watched again after a checkout removed it and made it again | `Error: src/gen/b.ts was not heard` |
| is let go when it is removed, and the rest of the tree stays watched | `Error: gone was not heard` |

On the exact initial source, the second case instead returned
`AssertionError: expected -1 to be greater than or equal to 0`; the fifth returned
`Error: dist/y-1.js was not heard`. The other five assertions matched. Reproduction
on the old source is evidence of a pre-existing failure, not proof of its cause
and not a basis for calling it flaky or load-related.

The complete current Bun suite reported 931 passed, 7 failed, 3 skipped across
63 files; Node reported 938 passed, 3 skipped across 63 files. After installing
only the pinned browser into an owned store, the separately run UI command passed
152/152 cases and perf passed 7/7 budgets over 5 runs. Latest outcomes are 7/8
configured commands; there was no single successful eight-gate run.

The local consumer-upgrade evidence package retains command records 159, 160,
161 and 167, full stdout/stderr, hashes, source/old-lock controls and the comparison
of all assertions. The facts needed to start work are reproduced here so the card
does not depend on access to that local package.

## Bounded diagnostic plan

1. First distinguish the execution path. `src/core/watcher/tree.ts` selects
   `perDirectory()` only on Linux; macOS selects the single recursive `native()`
   watch. The test helper at `tests/watch-tree.test.ts:45` does not override that
   selection. `NATIVE_NAMES` changes the count allowance, not the implementation.
2. Run the same bounded new-directory, replacement and removal scenarios against
   the exported `watchTree()` in a standalone Bun child and in Vitest. Capture
   every event with the same deadline; also compare with the module mock removed.
   The existing successful unreadable-tree child only checks initial nested
   delivery, not these lifecycle guarantees.
3. If standalone Bun passes while Vitest fails, fix the test boundary with a
   small child helper following the existing unreadable-tree pattern. Keep the
   native lifecycle assertions. Polling, skipping Bun or lengthening waits alone
   would stop verifying the stated contract.
4. If standalone Bun also fails, investigate the native watch/fallback contract
   before changing production behavior. The startup recursive-watch probe proves
   only an initial nested event, not continued delivery or replacement recovery.
5. Update `docs/reference/05-watcher.md`: its assertion that no case goes quiet
   under Bun is broader than the measured evidence. Keep old measurements tied
   to their original platform/epoch; document which implementation each test
   actually exercises. Add a regression check that fails on the old claim.
6. Keep the original verification requirement above: three successful consecutive
   isolated macOS/Bun runs, followed by all configured gates. Verify Linux and
   Node remain covered; a macOS pass cannot prove unused per-directory code.

The Bun/Vitest native-watch limitation is a source-backed hypothesis, supported
by the adjacent suite's explicit Bun polling seam and its documented earlier
measurement. It is not a newly measured root cause. This follow-up remains queued;
it was not accepted or closed as part of the tool update.

## Owner acceptance decision — 2026-11-01

After receiving300ms/exit0,302ms/exit1 and RESTORE timeout/exit1(no median), the owner answered the proposal for an additional quiet series: “Закрепляем текущие результаты, они приемлемые”. The current performance result is accepted with this known deviation; the proposed extra series and further performance optimization are not run. The original numerical requirements and failed receipts remain intact. Remaining configured commands and independent documentation review are completed; no eight-of-eight success is asserted.
