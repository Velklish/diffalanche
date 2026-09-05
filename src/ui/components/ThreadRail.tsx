import { useEffect, useMemo } from "react";
import { isAwaiting, isUnanswered } from "../../core/domain/counters.ts";
import { afterPaint } from "../perf.ts";
import { revealCard } from "../reveal.ts";
import type { RailScope } from "../store.ts";
import { useStore } from "../store.ts";
import type { Comment } from "../types.ts";
import { ThreadCard } from "./ThreadCard.tsx";

/**
 * The 392 px right column of handoff section 1.5: the two tabs with their
 * counts, the `unanswered` chip, the thread cards, and the collapsed activity
 * panel. A card here and the widget under its line are the same component; the
 * events of the panel are DA-25.
 */
export function ThreadRail() {
  const comments = useStore((store) => store.comments);
  const repo = useStore((store) => store.repo);
  const path = useStore((store) => store.path);
  const scope = useStore((store) => store.railScope);
  const unansweredOnly = useStore((store) => store.unansweredOnly);
  const awaitingOnly = useStore((store) => store.awaitingOnly);
  const setRailScope = useStore((store) => store.setRailScope);
  const toggleUnanswered = useStore((store) => store.toggleUnanswered);
  const toggleAwaiting = useStore((store) => store.toggleAwaiting);

  const here = useMemo(
    () => comments.filter((comment) => comment.repo === repo && comment.path === path),
    [comments, repo, path],
  );
  const scoped = scope === "file" ? here : comments;
  const visible = unansweredOnly
    ? scoped.filter(isUnanswered)
    : awaitingOnly
      ? scoped.filter(isAwaiting)
      : scoped;

  useFocusInView();

  return (
    <aside className="rail" aria-label="threads">
      <div className="rail-tabs">
        {/* Open threads, like every other number on the screen: the header's
            counters, the tree's badges, and the card's own badge all count what
            is still to be done. Resolved ones are listed, not counted. */}
        <Tab
          scope="file"
          label={`This file ${open(here)}`}
          on={scope === "file"}
          pick={setRailScope}
        />
        <Tab
          scope="all"
          label={`Review ${open(comments)}`}
          on={scope === "all"}
          pick={setRailScope}
        />
        <span className="spacer" />
        <button
          type="button"
          className={unansweredOnly ? "chip on" : "chip"}
          aria-pressed={unansweredOnly}
          onClick={toggleUnanswered}
        >
          unanswered
        </button>
        {/* The other half of the same question, and the one the header's second
            counter turns on. It appears only while it is on: the handoff has
            one chip here, and a filter the header set has to be undoable. */}
        {awaitingOnly ? (
          <button type="button" className="chip on" aria-pressed onClick={toggleAwaiting}>
            awaiting you
          </button>
        ) : null}
      </div>
      <div className="rail-list">
        {visible.length === 0 ? (
          <p className="rail-empty">{nothing(scope, unansweredOnly, awaitingOnly)}</p>
        ) : (
          visible.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} scope={scope} onFocus={reveal} />
          ))
        )}
      </div>
      <div className="feed">
        <span className="dot ok pulse" />
        AGENT ACTIVITY
        <span className="spacer" />
        <span className="caret">▸</span>
      </div>
    </aside>
  );
}

function Tab({
  scope,
  label,
  on,
  pick,
}: {
  scope: RailScope;
  label: string;
  on: boolean;
  pick: (scope: RailScope) => void;
}) {
  return (
    <button
      type="button"
      className={on ? "tab on" : "tab"}
      aria-pressed={on}
      onClick={() => pick(scope)}
    >
      {label}
    </button>
  );
}

/** How many of a set are still open; the tabs count those, not every thread. */
function open(comments: Comment[]): number {
  return comments.filter((comment) => comment.status === "open").length;
}

/**
 * The focused card is brought into the rail's own scroll. Focus is set from
 * both ends — a card here, and the widget under a line in the diff — and from
 * the diff end the card can be a long way down a list of two hundred.
 */
function useFocusInView(): void {
  const focusId = useStore((store) => store.focusId);
  useEffect(() => {
    if (focusId === null) return;
    document
      .querySelector(`.rail-list [data-thread="${CSS.escape(focusId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusId]);
}

/** DA-27 owns the empty states of the screen; the rail says its own in one line. */
function nothing(scope: RailScope, unansweredOnly: boolean, awaitingOnly: boolean): string {
  if (unansweredOnly) return "No thread is waiting for an agent.";
  if (awaitingOnly) return "No agent has answered and left it to you.";
  return scope === "file"
    ? "Nothing has been said about this file yet."
    : "This review session has no comments.";
}

/**
 * Focusing a card from the rail also brings its anchor into view. The card is
 * scrolled to first, because a file whose diff is not mounted has no line to
 * scroll to yet; the widget is reached on the next painted frame, once the
 * intersection observer has mounted it
 * ([ADR-008](../../../docs/adr/adr-008-diff-rendering-verdict.md)).
 */
async function reveal(id: string): Promise<void> {
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
