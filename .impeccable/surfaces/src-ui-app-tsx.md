---
version: 1
slug: "src-ui-app-tsx"
primary_target: "src/ui/App.tsx"
related_targets: ["src/ui/components/Header.tsx","src/ui/components/Sidebar.tsx","src/ui/components/CentrePanel.tsx","src/ui/components/ThreadRail.tsx","src/ui/components/ThreadCard.tsx","src/ui/components/StatusBar.tsx","src/ui/components/FileCard.tsx","src/ui/components/Overlay.tsx","src/ui/components/Toast.tsx","src/ui/components/Skeleton.tsx","src/ui/components/Logo.tsx","src/ui/Composer.tsx","src/ui/renderers/ReactDiffFile.tsx","src/ui/styles.css"]
---

# Surface: the review workspace

**Mode: Operate.** The visitor completes a task; they are not being persuaded and
they are not browsing. Scanability, consistency, and the real usage scene outrank
expression on this surface, and the brand lives in the precision of the details.

## Scope

`src/ui/App.tsx` and the five regions it lays out — the header, the sidebar, the
centre panel, the thread rail, and the status bar — plus the overlays that open
over them: the base picker, the sessions menu, global search, and the export
dialog. Section 1 of `docs/design/HANDOFF.md` is the layout and behaviour
authority for all of it.

This is the only screen of the MVP. Insights (handoff section 11) is a separate
surface for a later phase and gets its own brief when it is built.

## Audience and job

One reviewer, on their own machine, reading what coding agents changed across a
dozen repositories. The job is a loop and the surface exists to make the loop
fast: read a diff → select the lines that are wrong → say what is wrong → move
on; later, read the agent's answer and close what is verified. The reviewer runs
this for an hour at a time with a terminal open beside it.

Coding agents are the other half of the loop but never see this surface. They
arrive through the CLI, and their presence shows up here only as replies in
threads and as events in the activity feed.

## The task, and what has to be fast

Four things are on the critical path and have budgets in section 6 of the
specification: the first render (500 ms), scrolling (120 fps, no long tasks),
opening the composer and jumping to a file (50 ms each), and updating after an
agent's edit (300 ms). The screen is measured on the synthetic review — 21
repositories, 300 files, 30 000 diff lines, 200 comments — so every decision here
is made at that size, not at the size of a demo.

The keyboard is a first-class path, not an accelerator: `⌘K` and double-`Shift`
for search, `J`/`K` between open threads across repositories, `C` to comment,
`R` to resolve, `B` to browse, `⌘⏎` to send, `esc` to close. The full map is in
the handoff.

## Content

Everything on screen is real: the reviewer's own repositories, their own diffs,
their own comments. There is no marketing copy, no illustration, no empty
decoration, and no demonstration data — the demo-state switcher in the prototype
is a prototype affordance and is not built.

The interface carries English and Russian strings side by side, which is why the
monospace family ships cyrillic subsets.

## Constraints

- Minimum width 1560 px. Below it the window scrolls sideways; the panels keep
  308 / flexible / 392 and nothing collapses. No mobile layout, ever.
- The whole review arrives in one response. Nothing is lazily loaded as the
  reviewer scrolls.
- While the server answers, the surface shows the real header, silhouette rows in
  the sidebar, and one empty file card. No spinner, no shimmer, no layout shift
  when the data lands.
- A live edit must not lose the reading position or close the composer, and must
  not repaint a file card — only the affected lines and threads change.
- The diff rows come from the diff library. This surface owns the frame around
  them: the gutter, the range highlight, and where the composer and the threads
  attach.
- Virtualisation is allowed but may not break drag selection or detach a thread
  from its anchor.

## Direction on this surface

The system's north star is "The Quiet Control Room"; on this screen that means
the diff is the only thing with content and everything else is instrumentation
around it. The centre panel is the widest region and the only one that is
`bg`-coloured; the sidebar and the rail are `panel`, one step lighter, so the
reading column reads as a well rather than as a third panel.

The memorable moment is the composer: dragging across lines of the new side
opens a form directly under the last selected line, inside the diff, with the
range still highlighted above it — the finding is written where it belongs
instead of in a side panel that has lost the code.

## Unresolved on this surface

- The header's menus, live update, the keyboard map and search, and the empty
  states are not built yet (DA-24 to DA-27). Each arrives with the store slice it
  needs; this brief is what they are built against. The composer (DA-22) and the
  thread cards (DA-23) are built.
- The focus treatment is currently two shapes — a border change on bordered
  controls, a 1 px outline on rows that have none. That is deliberate and
  recorded in `DESIGN.md`, but no keyboard pass has walked the whole surface yet;
  DA-26 owns that walk.
