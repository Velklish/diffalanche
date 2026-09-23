# DA-82 · The file-jump budget measures a scroll the harness hook performs, not the one the product performs

- **Order:** 210
- **Scope:** 11-perf, 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The budget line is named "Jumping to a file from the navigation" ([perf/budgets.ts](../../../perf/budgets.ts):40, `fileJumpMs`, 50 ms), and the navigation it names is a click on a row in the sidebar. That click runs two things:

[src/ui/components/Sidebar.tsx](../../../src/ui/components/Sidebar.tsx):282-283

```ts
setCurrent(repo, file.path);
void revealCard(`[data-file="${CSS.escape(id)}"]`);
```

and `revealCard` is not one scroll but three rounds — [src/ui/reveal.ts](../../../src/ui/reveal.ts):32-42, with `ROUNDS = 3` at line 13, because "every card around the target replaces its estimate with its real height the moment it mounts — which moves the target out from under the reader after the jump has already happened" (reveal.ts:1-7).

The hook the gate measures runs neither:

[src/ui/App.tsx](../../../src/ui/App.tsx):104-111

```ts
const jumpToFile = useCallback(async (index: number) => {
  const target = document.querySelector(`[data-file-index="${index}"]`);
  if (!target) throw new Error(`no file card ${index}`);
  const start = performance.now();
  target.scrollIntoView();
  const painted = await afterPaint();
  return painted - start;
}, []);
```

No `setCurrent`, no `revealCard`, and a selector that exists only for this hook: `grep -rn "data-file-index" src perf e2e tests scripts` returns exactly two lines — the attribute at [src/ui/components/FileCard.tsx](../../../src/ui/components/FileCard.tsx):155 and the query above. Its two sibling hooks do drive the shipped action — `openComposer` calls `openComposerAt` ([App.tsx](../../../src/ui/App.tsx):76) and `switchSession` calls the store's `switchSession` ([App.tsx](../../../src/ui/App.tsx):96) — so this one is the exception rather than the house style.

What follows is that the gate does not gate the jump. A regression inside `revealCard` — a fourth settling round, a change to the store write that precedes it, a mount pattern that pushes the target further out from under the reader — leaves `fileJumpMs` untouched, because `perf.jumpToFile` never enters that code. The number the reference records for the line, 7.7 ms against 50 ([11-perf.md](../../reference/11-perf.md):370), is the cost of one `scrollIntoView` and one paint on the synthetic review; it is not evidence about the path a reader takes, and reading it as such is the actual harm.

The remaining cover is thin and known to be unsound. [e2e/sidebar.spec.ts](../../../e2e/sidebar.spec.ts):89-102 does click a real `.file-row` and assert `jump < 50`, but on the small e2e fixture, from a single sample, with none of the gate's median-of-three or runner allowance — which is item 6 of [DA-60-flaky-test-hardening.md](DA-60-flaky-test-hardening.md), filed there as a budget held to a stricter rule in a suite that is not the gate. So the shipped jump is asserted only there, and never on the 300-file synthetic review the budget was written for.

One further consequence is a hypothesis and is written as one: the harness jumps to `[files - 1, Math.floor(files / 2), 0]` ([perf/harness.ts](../../../perf/harness.ts):115) and takes the median of the three ([harness.ts](../../../perf/harness.ts):148), and the preceding `scrollRun` leaves the page at the bottom, so the two later jumps land on cards whose `DiffBody` has been unmounted down to a spacer of its measured height ([FileCard.tsx](../../../src/ui/components/FileCard.tsx):370-400). If the IntersectionObserver notification that remounts them is delivered after the `setTimeout(0)` inside `afterPaint` ([src/ui/perf.ts](../../../src/ui/perf.ts):54-61), the stamped frame shows the spacer rather than the diff, and two of the three samples the median is taken over measure an empty box. This has not been measured — measuring it means running the gate.

## Work to do

- Point the hook at the shipped path: have `perf.jumpToFile` resolve the repository and path of the file at that index from the store, call the same `setCurrent` and `revealCard` the sidebar row calls, and time from before `setCurrent` to the painted frame. What the hook must not do is reimplement either of them.
- Decide, and write down, where the measured window ends. `revealCard`'s own comment (reveal.ts:35-36) argues the jump is the first synchronous scroll and the later rounds are corrections; the alternative is the frame after the last round, which is when the reader stops being moved. The two differ by two frames and the budget was set for the first. Whichever is chosen, the number and the reason go in [11-perf.md](../../reference/11-perf.md) next to the row, because a reader comparing 7.7 ms with whatever this produces needs to know the window changed.
- Once the hook calls `revealCard`, remove `data-file-index` from `FileCard` if nothing else needs it, so the next person does not take it for a production hook. It is otherwise a candidate for the sweep in [DA-59-dead-code-sweep.md](../../archive/DA-59-dead-code-sweep/task.md).
- Check what the stamped frame actually contains at the moment the hook resolves — whether the target card's body is mounted or is still a spacer — and, if it is a spacer, say in the reference that the budget covers the scroll and not the mount, or move the window to include the mount. This is the hypothesis above and needs one run of the gate to settle.

## Out of scope

- The e2e assertion's single sample and missing allowance, which is item 6 of [DA-60-flaky-test-hardening.md](DA-60-flaky-test-hardening.md).
- The value of the budget itself and its headroom off CI, [DA-54.3-perf-budget-headroom.md](../../archive/DA-54.3-perf-budget-headroom/task.md).
- `afterPaint`'s definition of a painted frame, which the same argument touches for other rows and is [DA-55.4-settle-measures-before-paint.md](../../archive/DA-55.4-settle-measures-before-paint/task.md).
- Whether a metric that was never produced can pass the gate, [DA-69-perf-gate-reports-green-unmeasured.md](../../archive/DA-69-perf-gate-reports-green-unmeasured/task.md).

## Verification

- `perf.jumpToFile` calls `revealCard`; a deliberate regression inside `revealCard` — a `ROUNDS` raised, or an added frame before the first scroll — moves `fileJumpMs`. Before this change it does not, which is the probe that shows the gate now covers the path.
- After the jump the store's current file is the one jumped to, asserted in the harness rather than only in e2e, so a hook that scrolled without `setCurrent` fails.
- `grep -rn "data-file-index" src perf e2e tests` finds nothing, or finds a caller that is not the harness.
- The recorded sample table in [11-perf.md](../../reference/11-perf.md) is re-run and the new `fileJumpMs` replaces 7.7 ms, with the window it now measures stated.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf` — the last one is the point of the change and must be run after it, not before.
