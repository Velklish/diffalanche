# ADR-008: Diff rendering verdict — react-diff-view with file-card virtualisation

**Status:** Accepted
**Date:** 2026-09-05
**Deciders:** Velklish

## Context

Phase 0 of `docs/SPEC.md` section 10 checks the stack against the performance
budgets of section 6 before any MVP code is written. The budgets are numbers on
the synthetic review of 21 repositories, 300 files, 30 000 diff lines: first
render 500 ms, scrolling at 120 fps with zero long tasks, opening the comment
form and jumping to a file 50 ms each.

[ADR-002](adr-002-stack-and-delivery.md) named `@git-diff-view/react` the
primary library and `react-diff-view` the fallback, and left the choice to this
spike. The handoff allows virtualisation as long as drag selection and thread
anchors keep working (`docs/design/HANDOFF.md`, "Performance & live update"),
and forbids lazy loading of data: the whole review arrives in one response.

Measured with `perf/run.ts` (DA-3), three runs per variant, medians below.
Machine: MacBook Pro 18,3, Apple M1 Pro, 8 cores, macOS 26.6.2. Browser:
Playwright 1.63.0 driving Chrome Headless Shell 153.0.8010.12. Fixture:
`bun run synth -- --out .perf/fixture`, the full profile.

A headless runner cannot measure frame rate, so the scrolling line is read as
two numbers: long tasks, which must be zero, and CPU time per frame, which must
stay under **8.3 ms** — the frame of 120 fps. 120 fps itself stays a manual
check on a 120 Hz display at each phase checkpoint
([ADR-006](adr-006-verification.md)).

## Options

- **Library → `@git-diff-view/react` / `react-diff-view`.** Both render split
  and unified views and widgets between lines. The first highlights on its own
  with lowlight; the second highlights through refractor tokens supplied by the
  caller.
- **Syntax highlighting → on / off.** The spec makes highlighting the library's
  job, so the honest comparison is with it on; the measurements with it off show
  what it costs.
- **Virtualisation → none / by file card.** No virtualisation keeps every one of
  the 300 files in the DOM. By file card mounts a file's diff only when an
  `IntersectionObserver` reports it near the viewport, keeping its measured
  height as a spacer.

## Measurements

Medians of three runs. `cpu/frame` is Chromium's own `TaskDuration` over the
scroll divided by the frames of that scroll; the scroll is one pass over the
whole review in up to 600 frames.

| Variant | first render | long tasks | cpu/frame | composer | file jump |
|---|---|---|---|---|---|
| git-diff-view | 9872 ms | 30 | 35.7 ms | 634 ms | 42.8 ms |
| git-diff-view, no highlighting | 8000 ms | 20 | 31.0 ms | 578 ms | 29.7 ms |
| react-diff-view | 2459 ms | 0 | 7.3 ms | 145 ms | 12.8 ms |
| react-diff-view, no highlighting | 1404 ms | 0 | 6.5 ms | 109 ms | 14.9 ms |
| git-diff-view, virtual | 31 ms | 0 | 16.3 ms | 15.1 ms | 5.4 ms |
| git-diff-view, virtual, no highlighting | 32 ms | 0 | 13.7 ms | 14.4 ms | 4.9 ms |
| **react-diff-view, virtual** | **34 ms** | **0** | **6.4 ms** | **13.9 ms** | **7.6 ms** |
| react-diff-view, virtual, no highlighting | 29 ms | 0 | 4.2 ms | 15.1 ms | 13.1 ms |

The same numbers against the budget table of `docs/SPEC.md` section 6, for the
two variants that carry syntax highlighting and for the winner:

| Metric | Budget | git-diff-view | react-diff-view | git-diff-view, virtual | react-diff-view, virtual |
|---|---|---|---|---|---|
| First render of the review after the server responds | 500 ms | 9872 ms ✗ | 2459 ms ✗ | 31 ms ✓ | 34 ms ✓ |
| Scrolling the diff: long tasks | 0 | 30 ✗ | 0 ✓ | 0 ✓ | 0 ✓ |
| Scrolling the diff: CPU per frame | 8.3 ms | 35.7 ms ✗ | 7.3 ms ✓ | 16.3 ms ✗ | 6.4 ms ✓ |
| Opening the comment form | 50 ms | 634 ms ✗ | 145 ms ✗ | 15.1 ms ✓ | 13.9 ms ✓ |
| Jumping to a file from the navigation | 50 ms | 42.8 ms ✓ | 12.8 ms ✓ | 5.4 ms ✓ | 7.6 ms ✓ |
| Switching review sessions | 100 ms | not measurable in Phase 0 — there is one session | | | |
| Update after an edit in one repository | 300 ms | not measurable in Phase 0 — there is no watcher | | | |

Two numbers are not the library's doing and are recorded so they are not read as
such. Opening the composer first measured 13 167 ms because the whole review
re-rendered; memoising the file card brought it to 15 ms, and that memoisation
is now part of the skeleton. First render in a virtualised variant is the frame
that shows the review, with the diffs outside the viewport not yet in the DOM —
which is what the budget line asks about, and what the person sees.

## Decision

- The diff is rendered by **`react-diff-view`**, one `Diff` per file card, split
  view, with **virtualisation by file card**. This is the fallback
  [ADR-002](adr-002-stack-and-delivery.md) provided for; `@git-diff-view/react`
  is not used.
- Syntax highlighting comes from `react-diff-view`'s `tokenize` with
  **refractor**, per file, computed when a card mounts. `react-diff-view` was
  written against refractor 3, whose `highlight` returned an array of nodes,
  while refractor 5 returns a hast root: `src/ui/renderers/ReactDiffFile.tsx`
  adapts one to the other in three lines. Without the adapter the page throws
  and renders nothing.
- The CPU budget per frame is **8.3 ms**, the frame of 120 fps, and the gate of
  DA-5 checks it together with zero long tasks.
- This revises two lines of [ADR-002](adr-002-stack-and-delivery.md), which
  carries a note pointing here. The first is the diff library, whose fallback
  ADR-002 named itself. The second is "no `Bun.*` outside build scripts":
  `src/server/runtime.ts` calls `Bun.serve` on Bun and imports
  `@hono/node-server` on Node, and it is the only module in `src/` allowed to
  know the difference. Both rules are worded that way in `AGENTS.md`.
- The spike page stays as the skeleton of the Phase 1 UI: `src/ui` (shell, file
  cards, renderer, composer placeholder, measurement hooks), `src/server` (the
  review in one response, the runtime switch), `perf/` (the harness). The second
  library and the variant switches are kept until DA-21 fixes the renderer, then
  removed with the dead dependency.

## Consequences

- No variant meets the budgets without virtualisation, so virtualisation is not
  an optimisation to add later: DA-21 and DA-22 build on it. The handoff's
  condition holds them to it — drag selection over lines and thread anchors must
  keep working when a line is outside the mounted window, and a thread whose
  line is not mounted still has to be visible and clickable in the rail.
- A card that has never been mounted uses a height estimated from its patch;
  only after it has been mounted once is its real height known. Scrolling
  backwards never jumps, scrolling forwards past unseen files can. DA-21 owns
  making the estimate good enough that the scrollbar does not visibly drift.
- `@git-diff-view/react` loses its place in the stack. Its widget API
  (`extendData`, `renderExtendLine`) was the nicer one for the composer;
  `react-diff-view` puts a widget under a line through `widgets` keyed by
  change, which DA-22 uses instead.
- Highlighting costs about a second of first render without virtualisation and
  2 ms of CPU per frame with it. It stays on: the spec makes it the library's
  job, and the budget holds with it.
- Two budget lines are still unmeasured. DA-25 (live update) and DA-9 (sessions)
  are the tasks that make them measurable, and they turn the pending lines of
  the gate on.

## Delivery channels (DA-4)

The same spike proved both channels of `docs/SPEC.md` section 3, decision 2 on a
CLI with `version`, `serve`, and `--help`. `scripts/build.ts` produces
`dist/cli.js` for npm and one binary per target; the binary carries the UI
inside itself, base64 in a module the bundler embeds, so it serves the page with
no files next to the executable. Measured on the machine named above, Bun 1.3.14
and Node 25.2.1; cold start is the median of ten runs of `version`, timed around
`spawnSync`.

| Channel | Size | Cold start of `version` |
|---|---|---|
| npm bundle on Node (`node dist/cli.js`) | 107 KiB + 1.4 MiB of UI | 110 ms |
| npm bundle on Bun (`bun dist/cli.js`) | the same files | 31 ms |
| From source on Bun (`bun src/cli/index.ts`) | — | 29 ms |
| Binary, darwin-arm64 | 60.6 MiB | 33 ms |
| Binary, darwin-x64 | 67.9 MiB | not run here |
| Binary, linux-arm64 | 91.3 MiB | not run here |
| Binary, linux-x64 | 92.2 MiB | not run here |
| Binary, windows-arm64 | 92.1 MiB | not run here (DA-45) |
| Binary, windows-x64 | 95.9 MiB | not run here (DA-45) |

All six targets cross-compile on macOS with Bun 1.3.14, windows-arm64 included.
A binary is mostly the Bun runtime: the bundled code and the embedded UI are two
megabytes of the sixty. Node pays about 80 ms more than Bun to start the same
bundle, which is the cost of the npm channel and is well under what a person
notices on a command that then reads git.

The runtime switch lives in `src/server/runtime.ts` alone: Bun serves with
`Bun.serve`, Node through `@hono/node-server`. Nothing else in `src/` knows
which runtime it is on, and the CLI entry differs between channels only in where
the UI comes from — `dist/ui` next to the bundle, or the module inside the
binary.

## Re-measured after the review

The review of DA-3 to DA-5 changed two things that touch the numbers above: the
renderer registers nine refractor grammars instead of the package's root export,
which registers every Prism language, and the reader now runs `git diff HEAD`.
The UI bundle went from 1425.7 kB to 1370.5 kB, and the winner measured again on
the same machine, three runs, medians: first render 32.6 ms, zero long tasks,
6.9 ms of CPU per frame, composer 12.3 ms, file jump 7.8 ms. Nothing moved
enough to change the verdict, and the table above stands as measured.

One run of the same gate on the same commit came out red — 9.4 ms of CPU per
frame and eight long tasks — while the machine carried a load average of about
13 on eight cores. The numbers here are measurements of a quiet machine; the
budget has 1.4 ms of headroom, and a busy machine spends it. DA-5.1 is where
that is being decided for the CI runner.
