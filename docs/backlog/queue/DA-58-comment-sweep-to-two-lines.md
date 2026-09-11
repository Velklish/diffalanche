# DA-58 · Bring every comment over two lines into the rule: compress, move to docs, or delete

- **Order:** 230
- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** [DA-57](../../archive/DA-57-code-comments-are-two-lines/task.md)

## Context

[ADR-011](../../adr/adr-011-comment-length.md) sets the rule; this empties the
backlog of comments written before it. The count, and the command that produces
it, are in the ADR — 720 blocks over two lines, 4 161 lines, 13.1 % of the
31 842 lines in `src/`, `tests/`, `e2e/`, `perf/` and `scripts/`. By area:

| Area | Blocks over two lines |
|---|---|
| `src/` | 523 |
| `tests/` | 91 |
| `e2e/` | 71 |
| `scripts/` | 20 |
| `perf/` | 15 |

By kind: 474 JSDoc, 209 runs of `//`, 37 other `/* */`. The awk command counts a
block only when the line starts it, so it misses ten `{/* */}` comments inside
JSX and the thirteen in `.github/workflows/`; counting those, the population is
743. The longest single block is 27 lines
([tests/watcher.test.ts:90](../../../tests/watcher.test.ts)), and
[src/ui/keys.ts:1](../../../src/ui/keys.ts) opens with 25. The densest files are
[src/ui/store.ts](../../../src/ui/store.ts) with 61 blocks,
[src/core/watcher/index.ts](../../../src/core/watcher/index.ts) with 34 and
[src/ui/styles.css](../../../src/ui/styles.css) with 32.

An audit sweep read about 230 of the 743 blocks and classified them. The split is
lopsided, and it decides how this task is done: **21 blocks are noise** — all of
them three-line `// ---` section-divider banners in `e2e/acceptance.spec.ts`,
`scripts/synth.ts`, `src/core/domain/scope.ts` and `src/core/storage/index.ts`,
labelling a section the surrounding names already label. Everything else read
carried a fact the code does not state. The same sweep found **no commented-out
code and no `TODO`/`FIXME`/`HACK`/`XXX` marker anywhere**, and no stale comment
in the three claims it checked against the tracker and the code
(`ci.yml`'s DA-45 note, `budgets.ts`'s `pendingUntil: "DA-24.1"`,
`Sidebar.tsx`'s "the all files tab is Phase 2").

So this is not a deletion task with some relocation in it. It is a relocation
task with 21 deletions in it.

Three things are mixed in that population and they are not handled the same way.
Some blocks restate what the line below them does and go. Some record a decision
or a measurement that exists nowhere else — the runner allowance in
[perf/budgets.ts](../../../perf/budgets.ts), the check-run names in
[.github/workflows/ci.yml](../../../.github/workflows/ci.yml), why the watcher
budget is asserted on top of a baseline in
[tests/watcher.test.ts:320](../../../tests/watcher.test.ts) — and those move to
the reference or to an ADR before the comment shrinks. Some contradict the code
they sit on, which is a defect to fix rather than text to move.

Deleting a block of the second kind is the failure mode of this task. It is
cheap to shorten 720 comments and expensive to notice, months later, that the
reason for a number is gone.

## Work to do

- Sort every block into one of three: **noise** (restates the code, narrates the
  obvious, is a leftover of a conversation, is commented-out code) — delete;
  **knowledge** — move the text to its `docs/reference/` section, or to an ADR
  when it is a decision, and leave at most two lines pointing there; **stale** —
  it disagrees with the code, so fix the disagreement first and then treat the
  result as one of the other two.
- Work by area, in the order of the table, and keep each area a separate commit:
  a sweep of 720 blocks reviewed as one diff is not reviewed.
- Grow `docs/reference/` as the knowledge lands. A section that ends up holding
  half of a subsystem's gotchas is the intended outcome, not a smell.
- Turn the count into a gate: a check that finds a comment block over two lines
  and fails, added to `gates` in `backslop.json` and to the CI `check` job. It
  goes in last, when the count is zero — a gate that lands red is not a gate.
- Cover the comment forms the ADR names and the count command does not:
  `.yml` under `.github/` and `scripts/smoke.sh`.
- Amend the `AGENTS.md` rule: the sentence saying the repository is not yet in
  compliance goes when it is.

## Out of scope

- Rewriting code. A comment that is hard to shorten because the code under it is
  unclear becomes a task of its own, not a refactor smuggled into a sweep.
- Markdown. The reference, ADRs, task files and `README.md` carry no limit.
- Adding comments where there are none.

## Verification

- The count command from [ADR-011](../../adr/adr-011-comment-length.md) prints
  `0`, and the same check is one of the `gates` in `backslop.json` and a step of
  the CI `check` job.
- Adding a three-line comment on purpose turns that gate red.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green — a sweep of this size touches files the suites cover,
  and a comment removed together with the line under it is exactly what they
  catch.
- Every block classified as knowledge has its text findable in
  `docs/reference/` or an ADR. Spot-check by taking three of the longest blocks
  from the history and searching the documentation for what they said.
