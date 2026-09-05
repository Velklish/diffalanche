/**
 * How tall a file card will be before its diff has ever been mounted, counted
 * from the patch alone. `styles.css` pins the row heights, so the count is the
 * height and the scrollbar does not drift while unseen files are scrolled past
 * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
import type { DiffView } from "./store.ts";
import type { Comment } from "./types.ts";

/** One row of the diff, and one hunk header, in pixels: `styles.css` fixes both. */
export const ROW_HEIGHT = 22;
export const HUNK_HEAD_HEIGHT = 26;

/**
 * The height a card will have and the width its widest line needs. In split view
 * a deletion and the insertion beside it share a row; in unified they are two.
 * The width is the longest line of the patch, in characters, which the card
 * hands to the table so it never measures its own content.
 */
export function measurePatch(patch: string, view: DiffView): { height: number; width: number } {
  let rows = 0;
  let heads = 0;
  let deletions = 0;
  let insertions = 0;
  let width = 0;
  let started = false;

  const closeBlock = () => {
    rows += view === "split" ? Math.max(deletions, insertions) : deletions + insertions;
    deletions = 0;
    insertions = 0;
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
      deletions += 1;
    } else if (kind === "+") {
      insertions += 1;
    } else if (kind === " ") {
      closeBlock();
      rows += 1;
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
