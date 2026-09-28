/** Bringing a card into view and keeping it there: the cards around it swap estimates for real
 * heights as they mount, so the scroll is repeated (08-ui.md, "Reaching a card"; ADR-008). */
import { newSideLines, oldSideRows } from "./context.ts";
import { afterPaint } from "./perf.ts";
import { useStore } from "./store.ts";

/** How many times the scroll is repeated; two rounds settle the small fixture. */
const ROUNDS = 3;

/** Where the page asks what is being read: under the 52 px header and 38 px repository bar, plus
 * 10 px. Two modules import it and three copies move with it (08-ui.md, "Navigation"). */
export const PROBE_Y = 100;

/** A changed file chosen from the tree or from global search: current, out of browse mode, in view.
 * The perf harness times this very call, so the budget covers the path a reader takes (DA-82). */
export function revealFile(repo: string, path: string): Promise<void> {
  const store = useStore.getState();
  if (store.browse) store.closeBrowse();
  store.select(repo, path);
  return revealCard(`[data-file="${CSS.escape(`${repo}/${path}`)}"]`);
}

export async function revealCard(selector: string): Promise<void> {
  const first = document.querySelector(selector);
  if (!first) return;
  // The first scroll is synchronous, so the card is in view on the next frame; the rest only
  // correct it, and the 50 ms of `docs/SPEC.md` section 6 covers all of it (DA-82).
  first.scrollIntoView();
  for (let round = 1; round < ROUNDS; round += 1) {
    await afterPaint();
    document.querySelector(selector)?.scrollIntoView();
  }
}

/** A thread focused and its anchor shown — the rail, `J`/`K`, a search hit: the card first, as an
 * unmounted diff has no line yet, then the widget once the observer has mounted it (ADR-008). */
export async function revealThread(id: string): Promise<void> {
  const store = useStore.getState();
  store.focusThread(id);
  const thread = store.comments.find((comment) => comment.id === id);
  if (thread === undefined || thread.repo === null) return;

  const repo = thread.repo;
  const file = thread.path === null ? null : `${repo}/${thread.path}`;
  // Read whole, the file has every line, and the thread is under its own on the side it names.
  const browse = (path: string) =>
    store.openBrowse(repo, path, {
      rev: thread.side === "old" ? "base" : "worktree",
      line: thread.endLine ?? thread.line,
    });
  // A file the review has no card for.
  const entry = store.files.find((one) => one.id === file);
  if (thread.path !== null && entry === undefined) {
    browse(thread.path);
    return;
  }
  // The card's line or not is the patch's to say, not a widget that has not mounted yet (DA-37.1).
  const line = thread.endLine ?? thread.line;
  const inHunks =
    entry === undefined ||
    line === null ||
    (thread.side === "old"
      ? oldSideRows(entry.file.patch).rows.has(line)
      : newSideLines(entry.file.patch).lines.has(line));
  // A card the reader collapsed has no diff to show the thread in: it opens again.
  if (file !== null && store.collapsedFiles[file] === true) store.toggleFile(file);
  if (store.browse) {
    // Leaving puts back the file the review was on; the thread's own is the one to show.
    store.closeBrowse();
    store.focusThread(id);
  }
  const card =
    file === null
      ? `[data-repo-section="${CSS.escape(thread.repo)}"]`
      : `[data-file="${CSS.escape(file)}"]`;
  await revealCard(card);
  if (thread.line === null) return;

  if (await scrollToWidget(id)) return;
  if (file === null || thread.path === null) return;
  // A line outside every hunk has no row in the card at all, unless `↑ N lines` brought it in.
  if (!inHunks) {
    browse(thread.path);
    return;
  }
  // A collapsed hunk hides the anchor, and the thread just asked for is behind it: show the
  // context again and look once more rather than leave the click with no answer.
  store.expandHunks(file);
  await scrollToWidget(id);
}

/** Only the page scrolls to the widget: `scrollIntoView` would slide the card sideways too
 * (08-ui.md, "Threads"). The card may still be mounting, so it is looked for over a few frames. */
async function scrollToWidget(id: string): Promise<boolean> {
  for (let frame = 0; frame < 3; frame += 1) {
    await afterPaint();
    const widget = document.querySelector(`[data-thread-anchor="${CSS.escape(id)}"]`);
    if (widget) {
      const box = widget.getBoundingClientRect();
      window.scrollBy({ top: box.top + box.height / 2 - window.innerHeight / 2 });
      return true;
    }
  }
  return false;
}
