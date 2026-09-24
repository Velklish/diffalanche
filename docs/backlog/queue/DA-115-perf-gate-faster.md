# DA-115 · The perf gate takes about 67 s a run, and nobody has measured where a repetition spends its 13 s

- **Order:** 790
- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-24
- **Dependencies:** none

## Context

The owner asked on 2026-09-24 for the perf gate to take less time. One local run of `bun run perf` takes about 67 s on an M1 Pro (11-perf.md, "The CI jobs"): five repetitions of about 13 s each and the UI build, plus about 6 s when the fixture is generated. Each repetition is a process of its own — `perf/gate.ts` runs `perf/run.ts --runs 1` per repetition, each with its own server and Chromium, because a second browser in one process stalled (DA-25.2). Inside one repetition the harness (`perf/harness.ts`) starts the server and prepares two sessions (40 comments), launches Chromium, waits for the first render, scrolls the review one step a frame for `SCROLL_FRAMES` = 600 frames, opens the comment form, jumps to a file, switches sessions, and edits a file and waits for the page to show it.

Nobody has measured where the 13 s go. A hypothesis, not measured: the scroll is most of it — 600 frames paced by `requestAnimationFrame` take 10 s at 60 Hz.

## Work to do

- Time each phase of one repetition first (a line per phase on stderr, or a `--timings` flag) on the quiet machine, and write the breakdown into 11-perf.
- Take the most expensive phase first. Candidates, none decided:
  - the scroll: fewer frames, or a frame rate the browser does not throttle (`--disable-frame-rate-limit`, `--disable-gpu-vsync`) — both change how CPU per frame and the long-task count are taken;
  - one process for all repetitions, a fresh browser context per repetition, once DA-25.2's stall is found — the setup of the server and the sessions paid once;
  - `bun run build:ui` skipped when `dist/ui` is already built from the same sources.
- **Any change to how a number is taken is shown before it lands:** `bun perf/compare.ts` between the old and the new way on the quiet machine, nine runs a side, a second run agreeing, and the resolution table of 11-perf ("What the gate resolves") measured again for the new way. A line whose meaning changes says so in 11-perf and in `docs/SPEC.md` section 6.

## Out of scope

- Repetitions in parallel: they would share the machine they measure.
- The budgets and the gate's verdict rule (the median of five against the budget).
- The number of repetitions, which DA-110 set.

## Verification

- The breakdown of one repetition by phase, measured on the quiet machine, in 11-perf.
- For each change that lands: the gate's time before and after, and `bun perf/compare.ts` old way against new, nine runs a side with a second run agreeing, saying no difference on every line — or the line whose meaning changed, named in 11-perf and SPEC section 6 with its new resolution.
