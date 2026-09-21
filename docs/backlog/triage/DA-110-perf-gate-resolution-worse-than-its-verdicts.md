# DA-110 · Two runs of the perf gate on identical code disagree by a quarter, so the gate cannot resolve the differences it is asked to judge

- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-22
- **Dependencies:** none

This is a task in its own right and not a finding under a parent, which is why
it carries no cost label: it asks for the gate's own resolution to be known and
stated, which no single task owns. [DA-109](DA-109-reference-frame-tables-are-tied-to-nothing-that-fails.md) sits here on the same footing.

## Context

`bun run perf` already takes the median of three repetitions and refuses to
measure above a load ceiling ([ADR-013](../../adr/adr-013-perf-gate-off-ci.md)).
Both guards fired correctly on 2026-09-21, and the numbers still moved further
between two accepted runs than the differences those runs were being used to
judge.

Two full runs of the gate, eight minutes apart, on trees whose executable
content is identical — the twenty files between them are all markdown, and
`git diff --name-only e3224ca 5e0ee24 | grep -v '\.md$'` is empty:

| Line | Budget | Run A, entry load 7.52 | Run B, entry load 8.82 |
|---|---|---|---|
| First render | 500 ms | 123.1 ms | 172.5 ms |
| Scrolling: long tasks | 0 | 0 — ok | 1 — FAIL |
| Scrolling: CPU per frame | 9.5 ms | 9.3 ms — ok | 10.3 ms — FAIL |
| Opening the comment form | 50 ms | 25.4 ms | 28.9 ms |
| Jumping to a file | 50 ms | 14.5 ms | 11.9 ms |
| Switching review sessions | 100 ms | 83.5 ms — ok | 104.3 ms — FAIL |
| Update after an edit | 300 ms | 330 ms — FAIL | 391 ms — FAIL |

One red line became four on the same code. The medians moved by 18% on the
update line, 25% on the session switch, 11% on CPU per frame and 40% on first
render, and the long-task count crossed a budget whose whole range is zero
against one.

The spread inside a single run is of the same order. Run B's three repetitions
gave update 349 / 391 / 470, session switch 104.3 / 99.5 / 144.7, CPU per frame
10.7 / 10.3 / 9.4, long tasks 0 / 3 / 1 — so the median of three does not
settle down to a number either.

**What this costs is not the red lines, it is the comparisons.** The same
evening's acceptance used a base-against-merged run of this gate to conclude
that a landed branch was "no worse than the base on any line". Two of the three
differences it rested on were 7% and 6% — well inside the spread measured here,
so those two conclusions are not supported by the evidence that was taken for
them. The third, a 39% improvement on the session switch, is outside it and
agrees in direction with a second, independently taken pair, so it survives.

That is the shape of the problem: the gate is trusted for pass/fail against a
budget, and it is then also used for A/B comparisons it cannot resolve.

## Work to do

- **Measure the gate's own resolution and write it down** in
  [11-perf.md](../../reference/11-perf.md), next to what each line means: how
  large a difference has to be before this harness can see it, per line, on a
  known-quiet machine. Until that number exists, every comparison made with
  this gate is of unknown strength.
- **Decide what a comparison run must be.** A single run per side does not
  reach the resolution above. Interleaving several runs per side under one hold
  of the machine lock is what this run used for other measurements and it
  worked; make it the documented procedure for "is this branch worse than its
  base", or say plainly that the gate does not answer that question.
- **Look at the repetition count.** Three is what the harness takes; the spread
  above suggests the median of three is not stable for these lines. Whether the
  answer is more repetitions, a trimmed statistic, or a longer warm-up is the
  measurement this task should produce rather than assume.
- **Look at the first repetition separately.** Across several series taken this
  evening the first run of a series was visibly warmer or slower than the rest;
  a warm-up that is discarded by rule, declared before the run, is cheaper than
  a rule chosen after seeing the numbers.

## Out of scope

- The budgets themselves, and which lines are over them. Those are
  [DA-56.5](../queue/DA-56.5-scroll-does-not-fit-the-120-fps-frame.md),
  [DA-56.6](../queue/DA-56.6-update-step-lives-in-da-55.md) and
  [DA-69.1](../queue/DA-69.1-long-task-count-follows-the-machine.md).
- The load precondition and what it reads, which is
  [DA-54.5](../queue/DA-54.5-load-precondition-reads-one-minute-only.md). Both runs above
  passed it; this task is about what happens after it passes.
- Making the suites faster.

## Verification

- `11-perf.md` states, per line, the smallest difference this harness can see,
  with the runs that establish it.
- The documented comparison procedure, run twice on identical trees, returns
  "no difference" both times.
- A line whose budget is a count rather than a duration is either given a
  resolution too, or is said not to have one.
