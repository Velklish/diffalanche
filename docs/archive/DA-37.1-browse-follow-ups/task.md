# DA-37.1 · Browse mode: the open file does not follow live edits, a long file re-renders whole on a drag, a thread outside the hunks is not reached

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Parent:** DA-37
- **Cost:** minor

## Evidence

Finding discovered while working on DA-37. Three gaps the task left, each read off the code
rather than measured:

1. **The browsed file is read once.** `loadPlain` in `src/ui/store.ts` runs from `openBrowse`
   and `setPlainRev` only; the live stream patches the change set
   (`applyRepositoryDiff`) and never reads the browsed file again. An agent's edit to a file
   the reader has open in browse mode stays invisible until the file is opened again.
2. **A drag re-renders every row.** `PlainLines` in `src/ui/components/BrowseView.tsx` maps
   all lines into one list and subscribes to the selection bounds, so each line a drag crosses
   re-renders the whole list. Unmeasured; a 512 KiB file is about fifteen thousand rows, which
   is where it would show.
3. **A thread on a line of a changed file outside its hunks has no widget.** Such a thread is
   written from browse mode on a changed file, or on a line `↑ N lines` brought in and then
   dropped by a new patch. `revealThread` in `src/ui/reveal.ts` goes to the card, finds no
   widget, expands the collapsed hunks and still finds none; the thread is in the rail only.
   Opening browse mode at the line in that case would reach it.

Assumption, not measured: none of the three is reached by the perf gate's scenarios.
