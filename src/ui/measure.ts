/**
 * How tall a file card will be before its diff has ever been mounted, counted
 * from the patch alone. `styles.css` pins the row heights, so the count is the
 * height and the scrollbar does not drift while unseen files are scrolled past
 * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
import type { FileStatus } from "../core/types.ts";
import type { DiffView } from "./store.ts";
import type { Comment } from "./types.ts";

/** One row of the diff, and one hunk header, in pixels: `styles.css` fixes both. */
export const ROW_HEIGHT = 22;
export const HUNK_HEAD_HEIGHT = 26;

/** The two side panels, and the narrowest the reading column is asked to be;
 * `.app`'s floor is this plus whichever panels are shown (`styles.css`). */
export const SIDEBAR_WIDTH = 308;
export const RAIL_WIDTH = 392;
export const MIN_CENTRE = 860;

/** JetBrains Mono advances 0.6 em, so one character of the 12 px code is 7.2 px. */
const CH_PX = 7.2;
/** `.centre` pads 16 px each side and a file card carries a 1 px border. */
const CARD_CHROME = 34;
/** One gutter column, and the 10 px a code cell pads on each side. */
const GUTTER = 42;
const CELL_PADDING = 20;

/** How wide the reading column is: the page the layout lives in — the viewport
 * less a classic scrollbar — less the panels that are on the screen. */
export function centreWidth(pageWidth: number, sidebar: boolean, rail: boolean): number {
  const panels = (sidebar ? SIDEBAR_WIDTH : 0) + (rail ? RAIL_WIDTH : 0);
  return Math.max(pageWidth - panels, MIN_CENTRE);
}

/** How many characters one code column holds, counted from the widths
 * `styles.css` fixes ([08-ui.md](../../docs/reference/08-ui.md)). */
export function codeColumnChars(view: DiffView, status: FileStatus, centre: number): number {
  const single = view === "unified" || status === "added" || status === "deleted";
  const gutters = view === "split" && single ? 1 : 2;
  const code = (centre - CARD_CHROME - gutters * GUTTER) / (single ? 1 : 2) - CELL_PADDING;
  return Math.max(1, Math.floor(code / CH_PX));
}

/** The height a card will have, and the widest line it holds; `columns` is the
 * code column in characters, and `null` is the `scroll` toggle's no wrapping. */
export function measurePatch(
  patch: string,
  view: DiffView,
  columns: number | null = null,
): { height: number; width: number } {
  let rows = 0;
  let heads = 0;
  /** The rows each side of the current block takes, in the order `zip` pairs them. */
  let deletions: number[] = [];
  let insertions: number[] = [];
  let width = 0;
  let started = false;

  const visual = (line: string) =>
    columns === null ? 1 : Math.max(1, Math.ceil((line.length - 1) / columns));

  const closeBlock = () => {
    if (view === "split") {
      const paired = Math.max(deletions.length, insertions.length);
      for (let i = 0; i < paired; i += 1) {
        rows += Math.max(deletions[i] ?? 0, insertions[i] ?? 0);
      }
    } else {
      for (const one of deletions) rows += one;
      for (const one of insertions) rows += one;
    }
    deletions = [];
    insertions = [];
  };

  for (const line of patch.split("\n")) {
    if (!started) {
      if (!line.startsWith("@@")) continue;
      started = true;
    }
    const kind = line[0];
    if (kind === "@") {
      closeBlock();
      heads += 1;
      continue;
    }
    if (line.length - 1 > width) width = line.length - 1;
    if (kind === "-") {
      deletions.push(visual(line));
    } else if (kind === "+") {
      insertions.push(visual(line));
    } else if (kind === " ") {
      closeBlock();
      rows += visual(line);
    }
  }
  closeBlock();

  return { height: heads * HUNK_HEAD_HEIGHT + rows * ROW_HEIGHT, width };
}

/**
 * A thread card is written text, so its height is not fixed the way a diff row
 * is; these are the parts of it `styles.css` does fix — the borders, the
 * padding, the header, and the actions row — and the width the block gives one
 * line of body at 12.5px. The count is close enough that a card carrying
 * threads holds its place in the scrollbar before it has ever been mounted.
 */
export const THREAD_LINE_HEIGHT = 19;
export const THREAD_CHARS = 82;
export const THREAD_CHROME = 82;
export const REPLY_CHROME = 55;
/** The block the widgets of one line sit in, and the gap between two of them. */
export const WIDGETS_PADDING = 20;
export const WIDGET_GAP = 9;

/** How tall the widgets of one anchored line will be. */
export function measureThreads(threads: Comment[]): number {
  if (threads.length === 0) return 0;
  let height = WIDGETS_PADDING + (threads.length - 1) * WIDGET_GAP;
  for (const thread of threads) {
    height += THREAD_CHROME + wrapped(thread.body) * THREAD_LINE_HEIGHT;
    for (const reply of thread.replies) {
      height += REPLY_CHROME + wrapped(reply.body) * THREAD_LINE_HEIGHT;
    }
  }
  return height;
}

/** Lines a body takes once the block has wrapped it; a paragraph is at least one. */
function wrapped(body: string): number {
  let lines = 0;
  for (const paragraph of body.split("\n")) {
    lines += Math.max(1, Math.ceil(paragraph.length / THREAD_CHARS));
  }
  return lines;
}

/**
 * The new-side lines a collapsed hunk hides. `trimContext` in the renderer
 * drops the context that leads and trails a hunk's changes, so a thread
 * anchored to one of those lines has no row to sit under while the hunk is
 * collapsed — and no height to claim either.
 */
export function hiddenLines(patch: string, collapsed: Record<number, boolean>): Set<number> {
  const hidden = new Set<number>();
  if (Object.values(collapsed).every((one) => one !== true)) return hidden;

  let hunk = -1;
  let line = 0;
  /** The context lines seen since the last change of this hunk, in new-side numbers. */
  let leading: number[] = [];
  let trailing: number[] = [];
  /** Whether this hunk has had a change yet: it is what splits lead from trail. */
  let changed = false;

  const closeHunk = () => {
    if (hunk < 0 || collapsed[hunk] !== true) return;
    // What `trimContext` keeps is the span from the first change to the last;
    // a hunk with no change of its own has nothing to keep, and `leading` is
    // then all of it.
    for (const one of leading) hidden.add(one);
    for (const one of trailing) hidden.add(one);
  };

  for (const row of patch.split("\n")) {
    if (row.startsWith("@@")) {
      closeHunk();
      hunk += 1;
      line = Number(/\+(\d+)/.exec(row)?.[1] ?? 1);
      leading = [];
      trailing = [];
      changed = false;
      continue;
    }
    if (hunk < 0) continue;
    const kind = row[0];
    if (kind === "-") {
      changed = true;
      trailing = [];
      continue;
    }
    if (kind === "+") {
      changed = true;
      trailing = [];
      line += 1;
      continue;
    }
    if (kind !== " ") continue;
    if (changed) trailing.push(line);
    else leading.push(line);
    line += 1;
  }
  closeHunk();
  return hidden;
}
