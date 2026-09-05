/**
 * Bringing a card into view and keeping it there. A card that has never been
 * mounted holds its place with a height counted from its patch, and every card
 * around the target replaces its estimate with its real height the moment it
 * mounts — which moves the target out from under the reader after the jump has
 * already happened. Scrolling again once they have settles it
 * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
import { afterPaint } from "./perf.ts";
import { useStore } from "./store.ts";

/** How many times the scroll is repeated; two rounds settle the small fixture. */
const ROUNDS = 3;

export async function revealCard(selector: string): Promise<void> {
  const first = document.querySelector(selector);
  if (!first) return;
  // The first scroll is synchronous, so the jump is one frame and inside the
  // 50 ms budget of `docs/SPEC.md` section 6; the rest only correct it.
  first.scrollIntoView();
  for (let round = 1; round < ROUNDS; round += 1) {
    await afterPaint();
    document.querySelector(selector)?.scrollIntoView();
  }
}

/**
 * Focusing a thread and bringing its anchor into view: the card is scrolled to
 * first, because a file whose diff is not mounted has no line to scroll to yet,
 * and the widget is reached on the next painted frame, once the intersection
 * observer has mounted it
 * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)).
 *
 * It is what a click in the rail does, what `J` and `K` do, and what `⏎` on a
 * comment in global search does — one thread reached one way.
 */
export async function revealThread(id: string): Promise<void> {
  const store = useStore.getState();
  store.focusThread(id);
  const thread = store.comments.find((comment) => comment.id === id);
  if (thread === undefined || thread.repo === null) return;

  const file = thread.path === null ? null : `${thread.repo}/${thread.path}`;
  const card =
    file === null
      ? `[data-repo-section="${CSS.escape(thread.repo)}"]`
      : `[data-file="${CSS.escape(file)}"]`;
  await revealCard(card);
  if (thread.line === null) return;

  if (await scrollToWidget(id)) return;
  // The anchor is on a line a collapsed hunk hides: the reader put it away, and
  // the thread they just asked for is behind it. Show the context again and
  // look once more, rather than leaving the click with no answer.
  if (file === null) return;
  store.expandHunks(file);
  await scrollToWidget(id);
}

/**
 * The page scrolls to the widget, and nothing else: `scrollIntoView` would also
 * scroll the card sideways, and the reader would come back to a diff whose left
 * column has slid out of it. The card may still be mounting, so it is looked
 * for over a few frames.
 */
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
