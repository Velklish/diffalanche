/**
 * How tall a file card will be before its diff has ever been mounted, counted
 * from the patch alone. `styles.css` pins the row heights, so the count is the
 * height and the scrollbar does not drift while unseen files are scrolled past
 * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
import type { DiffView } from "./store.ts";

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
