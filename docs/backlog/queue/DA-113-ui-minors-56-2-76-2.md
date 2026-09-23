# DA-113 · UI minors: non-text contrast (DA-56.2) and the merged type change sized from one kind and drawn from another (DA-76.2)

- **Order:** 515
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Dependencies:** none

## Context

The run of 2026-09-23 touches `src/ui` anyway (DA-100.1, DA-102, DA-96), so the two minor entries filed against 08-ui are cut into one batch here rather than left waiting. Each entry keeps its own evidence in `minor/`; this card only names them.

## Work to do

- [DA-56.2](../minor/DA-56.2-non-text-contrast-unchecked.md) — non-text indicators have no contrast check: the design test covers text only, and WCAG 1.4.11 wants 3:1.
- [DA-76.2](../minor/DA-76.2-merged-type-change-status-mismatch.md) — a merged type change is "modified" in the core and "add" in the renderer, and the card is sized from one while it is drawn from the other.

Each entry is fixed, or closed with a stated reason why not; the outcome of each is one line in this batch's `result.md`.

## Out of scope

- Minor entries of other scopes: 02-git, 03-storage, 04-domain, 05-watcher and 07-server go to [DA-114](../../archive/DA-114-core-minors-batch/task.md); 11-perf waits for the perf pass.

## Verification

- Every fix has a test that turns red when the fix is reverted, or the result says why a test cannot hold it.
- Gates: `npx github:Velklish/backslop#v0.9.0 gates` green by count.
