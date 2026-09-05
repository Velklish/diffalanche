/**
 * Bringing a card into view and keeping it there. A card that has never been
 * mounted holds its place with a height counted from its patch, and every card
 * around the target replaces its estimate with its real height the moment it
 * mounts — which moves the target out from under the reader after the jump has
 * already happened. Scrolling again once they have settles it
 * ([ADR-008](../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
import { afterPaint } from "./perf.ts";

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
