import { useStore } from "../store.ts";

/**
 * The 392 px right column of handoff section 1.5: the two tabs with their
 * counts, the `unanswered` chip, and the collapsed activity panel. The thread
 * cards are DA-23, the events DA-25.
 */
export function ThreadRail() {
  const comments = useStore((store) => store.comments);
  const repo = useStore((store) => store.repo);
  const path = useStore((store) => store.path);

  const here = comments.filter((comment) => comment.repo === repo && comment.path === path).length;

  return (
    <aside className="rail" aria-label="threads">
      <div className="rail-tabs">
        <span className="tab on">This file {here}</span>
        <span className="tab">Review {comments.length}</span>
        <span className="spacer" />
        <span className="chip">unanswered</span>
      </div>
      <div className="rail-list" />
      <div className="feed">
        <span className="dot ok pulse" />
        AGENT ACTIVITY
        <span className="spacer" />
        <span className="caret">▸</span>
      </div>
    </aside>
  );
}
