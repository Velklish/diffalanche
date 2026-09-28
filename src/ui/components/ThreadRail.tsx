import { useEffect, useMemo } from "react";
import { isAwaiting, isUnanswered } from "../../core/domain/counters.ts";
import { revealThread } from "../reveal.ts";
import type { RailScope } from "../store.ts";
import { useStore } from "../store.ts";
import type { Comment } from "../types.ts";
import { ActivityPanel } from "./ActivityPanel.tsx";
import { PanelAway } from "./PanelAway.tsx";
import { ThreadCard } from "./ThreadCard.tsx";

/** The 392 px right column of handoff section 1.5; a card here and the widget under its line are
 * the same component (08-ui.md, "Threads"). */
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
        {/* Open threads, like every other number on the screen; resolved ones are listed, not
            counted (08-ui.md, "Threads"). */}
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
        {/* The header's second counter turns it on, and it shows only while on: the handoff has
            one chip here, and a filter the header set has to be undoable. */}
        {awaitingOnly ? (
          <button type="button" className="chip on" aria-pressed onClick={toggleAwaiting}>
            awaiting you
          </button>
        ) : null}
        <PanelAway side="rail" />
      </div>
      <div className="rail-list">
        {visible.length === 0 ? (
          <p className="rail-empty">
            {nothing(scope, unansweredOnly, awaitingOnly, path !== null)}
          </p>
        ) : (
          visible.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              scope={scope}
              place="rail"
              onFocus={revealThread}
            />
          ))
        )}
      </div>
      <ActivityPanel />
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

/** The focused card, brought into the rail's own scroll: focused from the diff, it can be a long
 * way down the list (08-ui.md, "Threads"). */
function useFocusInView(): void {
  const focusId = useStore((store) => store.focusId);
  useEffect(() => {
    if (focusId === null) return;
    document
      .querySelector(`.rail-list [data-thread="${CSS.escape(focusId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusId]);
}

/** The rail's own empty state in one line; with no current file it speaks about the review
 * (08-ui.md, "Threads"). */
function nothing(
  scope: RailScope,
  unansweredOnly: boolean,
  awaitingOnly: boolean,
  onFile: boolean,
): string {
  if (unansweredOnly) return "No thread is waiting for an agent.";
  if (awaitingOnly) return "No agent has answered and left it to you.";
  return scope === "file" && onFile
    ? "Nothing has been said about this file yet."
    : "This review session has no comments.";
}
