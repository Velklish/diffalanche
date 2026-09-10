# DA-54 · Repository boundary in the diff and jumps to a repository

- **Order:** 295
- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-10
- **Dependencies:** none

## Context

The reading column runs one repository after another with nothing between them but the repository header, and that header scrolls away with the diff. A repository of the synthetic review is around 18 000 px tall, so for most of the reading there is nothing on screen saying which repository the file belongs to. The tree has the same gap from the other side: clicking a repository row only collapses it, and there is no way to get to that repository in the diff.

The owner chose the sticky variant over a louder divider, on a mockup taken over the running UI: the repository line collapses to one row, sticks under the header while its files are being read, and is pushed out by the next repository. Jumps were chosen for two places — the name in the tree and the repository name on a thread card. The name inside the sticky bar itself is **not** a jump target.

## Work to do

- `.repo-head` becomes one line: path, `branch ← base · sha`, file count and `+/−`, and `Comment on repo` on the right, 38 px tall, `position: sticky; top: 52px`, opaque `--bg` ground with a `--bd` bottom border. Sticky inside its own `section.repo`, so each bar is pushed out by the next repository rather than stacking.
- A hairline (`--bd2`) above each section but the first, so the boundary reads at the moment of the transition as well as during it.
- `PROBE_Y` in [CentrePanel.tsx](../../../src/ui/components/CentrePanel.tsx) moves below the bar. The probe asks which card is under the header with `elementFromPoint`, and today it points at 62 px, which the bar would cover — the reason `.warnings` is deliberately not sticky ([styles.css](../../../src/ui/styles.css)). The new value follows from 52 px of header plus the bar; the test is that scrolling still moves the selection in the tree.
- The sidebar row splits into two targets: the caret `▾` toggles the branch, the repository name jumps to its section. Keyboard: `Enter` jumps, `Space` toggles; both stay reachable in the tab order, and the row keeps one focus ring, not two.
- The repository name on a thread card jumps to that repository's section.
- Jumping reuses `revealCard`/`reveal.ts` so the section top lands under the header and the 50 ms budget for “jump to a file” holds for a repository too.

**Documentation in the same pass.** `docs/design/HANDOFF.md` sections 1.3 (the tree row and its two targets) and 1.4 (the sticky bar and the section rule) with the keyboard map; `DESIGN.md` if any token moves, together with `src/ui/tokens.css`; `docs/reference/08-ui.md`; `CHANGELOG.md`. The Impeccable context loader runs before the first edit under `src/ui`, and `audit` and `polish` run on the surface before the task is reported, with every unfixed finding named.

## Out of scope

- Collapsing a whole repository from the sticky bar. It was offered and not chosen; if it comes back it is its own task.
- Anything about the scope of a task (DA-53, DA-55).

## Verification

- Playwright on the small synthetic fixture: scrolled into the middle of the second repository, the bar names the second repository and the first one's bar is not in the document's visible box; scrolled to the boundary, the arriving bar pushes the previous one out.
- The tree keeps working as a probe target: after a programmatic scroll into repository 3 and the settle delay, the selected file row belongs to repository 3.
- A click on the repository name in the tree puts the section top under the header and does not change the branch's collapsed state; a click on the caret toggles it and does not scroll.
- A click on the repository name of a thread card lands on the same section.
- `bun run perf` green: the scroll budget holds with a sticky element per section, and no long task appears.
- Gates from `backslop.json` green.
