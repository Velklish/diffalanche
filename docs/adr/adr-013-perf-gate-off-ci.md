# ADR-013: Off CI the perf gate declines to answer on a busy machine rather than answering wrongly

**Status:** Accepted
**Date:** 2026-09-21
**Deciders:** Velklish

## Context

`bun run perf` is one of the gates of `backslop.json`, run before any task is
reported. On a GitHub-hosted runner every millisecond ceiling is widened by
`RUNNER_ALLOWANCE` ([DA-5.1](../archive/DA-5.1-perf-gate-on-ci-runner/task.md));
on a development machine the ceilings are the specification's own numbers, and
[11-perf.md](../reference/11-perf.md) says why — a budget only CI enforces stops
being a budget developers meet.

That held while "a development machine" meant a quiet one. It is not quiet. The
measurements of DA-54, taken on the machine this project is developed on:

| what was measured | CPU per frame | budget |
|---|---|---|
| DA-54's commit, quiet machine | 8.2 ms | 8.3 |
| the base commit `1193ab3`, quiet machine | 8.2 ms | 8.3 |
| DA-54's commit, loaded machine | 8.5–11.3 ms | 8.3 |
| the base commit, loaded machine | 8.7–10.0 ms | 8.3 |
| DA-54's commit with the sticky bar removed (`position: static`) | 9.0 ms | 8.3 |
| DA-53 and DA-54 merged, load average 20.5 | 7.8 ms | 8.3 |

Two facts follow, and the second is why this is a decision rather than a note.

**On a quiet machine the margin is 0.1 ms — 1.2 %.** Anything running beside the
gate takes it over. That is not a budget that fails when the code gets slower; it
is a budget that fails when the laptop does something else.

**Under load the gate stops measuring the code at all.** With the whole subject
of DA-54 taken out — the same commit, one line changed — the run still failed at
9.0 ms, and across four paired runs the sign of the difference between a change
and its own base flipped both ways. A gate whose verdict does not move with the
code is not gating the code.

The same shape was measured again on 2026-09-21 while three workers shared this
machine ([DA-56.3](../archive/DA-56.3-perf-pass-over-the-package/task.md)): the
`Scrolling the diff: long tasks` line came out 4 at a load average of 37, 0 at
33, and 1 at 15 — the count followed the machine and not the tree, on two
different commits.

## Options

The question has one axis: what `bun run perf` means on a machine that is not
quiet.

- **A named allowance for a development machine**, the way CI has one. The
  cheapest: one constant and one branch. Rejected on its own cost, which DA-54.3
  states and the numbers above confirm — a 1.5× allowance puts the ceiling at
  12.4 ms, and the sticky-bar regression that measured 9.0 against 8.2 passes
  silently. A local run then catches no small regression at all, which is the
  whole reason the strict numbers are kept off CI.
- **Raise the budget to what the machine delivers.** Admissible only if 8.3 ms
  were a guess. It is not: it is the frame of 120 fps, which `docs/SPEC.md`
  section 6 asks for and which the gate stands in for because a headless runner
  cannot measure frame rate. Raising it is a way of not noticing.
- **A load precondition: the gate reads the load average and declines to produce
  a verdict — rather than a red one — when the machine is too busy to measure.**
  Honest, and it makes "the gate is red" mean something again. Its cost is a gate
  that sometimes declines to answer, which on an orchestrated run with several
  workers on one machine is every time.
- **A load precondition with a named bypass.** The third option plus one
  environment variable a person or an orchestrator sets deliberately, under which
  the gate measures and prints that the verdict is not evidence.

## Decision

The fourth: **a load precondition, with `DIFFALANCHE_PERF_IGNORE_LOAD=1` as the
named bypass.**

The gate reads the load average per core before the run and again after it —
the one- and five-minute figures, and before the run it waits for them first
(DA-54.5, [11-perf.md](../reference/11-perf.md)) — and takes the busier of the
two: a machine that got busy halfway through decided the numbers as much as one
that started busy. Above the ceiling
it prints `unable to measure`, names the load, and exits non-zero. Before the
run it does that without measuring at all, because a minute of browser time
that cannot produce a verdict is a minute spent on nothing. Declining *after*
the run, when the load rose during it, still prints the table — the numbers are
worth seeing — but under a `**Not evidence.**` banner and without the
`over budget:` line, so nothing in the output reads as a verdict. Since DA-54.4
the same precondition, at both ends and with the same bypass, stands around
`bun run test:ui` too ([08-ui.md](../reference/08-ui.md#ui-tests)).

`bun run perf` therefore has three reds and says which: a line **over budget**, a
line the gate has **no number it can trust** (`UNMEASURED`, from
[DA-69](../archive/DA-69-perf-gate-reports-green-unmeasured/task.md)), and a
machine too busy for any number off it to be about the code. Before this, all
three came out as the same exit code and the same table.

The bypass exits zero-or-red on the budgets as usual, and prints **Not
evidence.** with the load above the table. A bypass that is not visible in the
output is the first option under another name, so the line is not optional.

The threshold and the evidence behind it live in
[11-perf.md](../reference/11-perf.md), not here: the number is a measurement and
will be re-measured, while the decision to have a precondition at all is what
this record is.

**What this does not do.** The precondition separates a number decided by the
machine from a number decided by the code. It does not make a line green that is
red on a quiet machine, and one line was: `Scrolling the diff: CPU per frame`
measured 8.6–9.0 ms against its 8.3 ms budget in the quietest window available
on 2026-09-21, on three trees including `1193ab3`, which predates the whole
DA-53…56 package, and 8.5–9.1 ms over nine commits of that range with no trend.

That line was settled separately and by the same rule — measure, then choose the
number. The owner set the gate at **9.5 ms** on 2026-09-21 and kept 8.3 ms, the
frame of 120 fps, as the goal in `docs/SPEC.md` section 6 with the current
reading written beside it. Where 9.5 comes from: twenty-four readings on one
8-core M1 Pro, of which the ones taken below this record's ceiling — where the
gate produces a verdict at all — run 8.5 to 9.1 ms, worst 9.1. 9.5 leaves about
four percent over that worst trusted reading and still catches a regression the
size of the one the line was written for, which was 0.8 ms; 10.0 leaves ten
percent and catches almost nothing, and 9.2 sits against the worst reading and
brings back the flapping this record exists against. The two rejected
alternatives were keeping 8.3 as the gate and opening a task to meet it — which
makes `perf` red for everybody until that task lands — and measuring without
failing locally, which leaves the line guarded nowhere, since a runner ceiling
of 20.75 would have passed almost any regression.

## Consequences

- A red `bun run perf` on a development machine now means the code. A run that
  cannot mean anything says so instead of reporting a verdict.
- An orchestrated run on one machine has to serialise the gate, or set the
  bypass and read the table as an indication. Both are explicit; neither is the
  silent green that a development allowance would have produced.
- The threshold is one number on one machine, measured on few points. It is
  recorded with how it was obtained so the next reader can disagree with the
  measurement rather than with the mechanism.
- CI is untouched, and the code says so rather than the prose alone:
  `GITHUB_ACTIONS=true` turns the precondition off and keeps `RUNNER_ALLOWANCE`.
  A hosted runner's load is not anybody's to control, the allowance is what
  stands in for it there, and a gate that declined on CI would be a red job with
  nothing in it to fix — the `perf` job installs Chromium and generates a
  21-repository fixture immediately before the gate, so its own preparation
  would have tripped the check on four cores.
- `RUNNER_ALLOWANCE` is a ratio to a measured runner reading, and it is tuned to
  **one row: CPU per frame**, the tightest. One multiplier cannot leave the same
  headroom on seven rows that are not slow in the same proportion, and the other
  six get whatever it happens to produce — first render several times over what
  a runner measured. That is accepted: seven hand-maintained ceilings from the
  DA-5.1 readings cost more than they are worth. So **moving the CPU-per-frame
  budget recomputes the multiplier in the same pass, and moving any other
  millisecond budget does not touch it.** The rule exists because DA-56.4 moved
  that budget from 8.3 to 9.5 while the allowance stayed 2.5, carrying the
  runner ceiling from 20.8 to 23.8 against an unchanged measured 17.3. The
  readings are in [11-perf.md](../reference/11-perf.md).
- `DIFFALANCHE_PERF_IGNORE_LOAD` is a contract outside the code and is
  documented with the other environment variables; it cannot be removed without
  a successor to this record.
