import { memo, useCallback } from "react";
import { isAwaiting } from "../../core/domain/counters.ts";
import { threadAnchor } from "../anchor.ts";
import { revealCard } from "../reveal.ts";
import type { RailScope, ReplyPlace } from "../store.ts";
import { useStore } from "../store.ts";
import { relativeTime } from "../time.ts";
import type { Comment, Reply } from "../types.ts";
import { confirmedBy } from "../types.ts";

/** One thread of handoff section 3, drawn the same in the rail and under its
 * line; `place` is which copy, and `scope` is not ([08-ui.md], DA-94). */
export const ThreadCard = memo(function ThreadCard({
  thread,
  scope,
  place,
  onFocus,
}: {
  thread: Comment;
  scope: RailScope;
  /** Which copy of the thread this is; only the one `Reply` was pressed on
   * draws the field, and only it takes the caret. */
  place: ReplyPlace;
  /** What focusing this card means where it is shown: the rail also scrolls the diff. */
  onFocus: (id: string) => void;
}) {
  const focused = useStore((store) => store.focusId === thread.id);
  const replying = useStore((store) => store.replyId === thread.id && store.replyAt === place);
  const busy = useStore((store) => store.busy[thread.id] === true);

  const resolved = thread.status === "resolved";
  const state = resolved ? "RESOLVED" : isAwaiting(thread) ? "awaiting" : null;
  // Only on the tab that spans the review: on the file's own tab it would be the same word on
  // every card (DA-54).
  const repo = scope === "all" ? thread.repo : null;

  return (
    // The focus click is on the header rather than the card, so selecting the body text does not
    // move the focus (08-ui.md, "Threads").
    <article
      className={cardClass(focused, resolved)}
      data-thread={thread.id}
      aria-current={focused ? "true" : undefined}
    >
      {/* The repository goes somewhere else, so it is the one button beside the focus click,
          which owns the rest of the header (08-ui.md, "Threads"). */}
      <div className="thread-head">
        {repo === null ? null : <RepoJump repo={repo} />}
        <button type="button" className="thread-focus" onClick={() => onFocus(thread.id)}>
          <span className={`sev-tag ${thread.severity}`}>{thread.severity.toUpperCase()}</span>
          <SeverityMarker thread={thread} />
          <span className="thread-anchor">{threadAnchor(thread)}</span>
          <span className="spacer" />
          {state === null ? null : (
            <span className={resolved ? "thread-state resolved" : "thread-state awaiting"}>
              {state}
            </span>
          )}
        </button>
      </div>

      <p className="thread-body">{thread.body}</p>

      {thread.replies.map((reply) => (
        <ThreadReply key={reply.id} reply={reply} />
      ))}

      <div className="thread-actions">
        <StatusButton thread={thread} busy={busy} />
        <button
          type="button"
          className="ghost small"
          onClick={() => useStore.getState().openReply(replying ? null : thread.id, place)}
        >
          Reply
        </button>
        <span className="spacer" />
        <span className="thread-meta">
          {thread.author} · {relativeTime(thread.createdAt)}
        </span>
      </div>

      {replying ? <ReplyField id={thread.id} busy={busy} /> : null}
    </article>
  );
});

/** The repository of a thread, by the `revealCard` the tree jumps with, so its 50 ms budget holds
 * here too; the rail has room for the last segment (08-ui.md, "Threads"). */
function RepoJump({ repo }: { repo: string }) {
  return (
    <button
      type="button"
      className="thread-repo"
      title={repo}
      onClick={() => void revealCard(`[data-repo-section="${CSS.escape(repo)}"]`)}
    >
      {repo.split("/").at(-1)}
    </button>
  );
}

/** Handoff section 3: `auto` while the model's severity waits for an agent, then who confirmed it;
 * nothing for a severity its writer chose. */
function SeverityMarker({ thread }: { thread: Comment }) {
  const by = confirmedBy(thread.severitySource);
  if (thread.severitySource !== "auto" && by === null) return null;
  const text = by === null ? "auto" : `labelled by ${by}`;
  return (
    <span className="thread-marker" title={text}>
      {text}
    </span>
  );
}

function cardClass(focused: boolean, resolved: boolean): string {
  return ["thread", focused ? "on" : "", resolved ? "resolved" : ""].filter(Boolean).join(" ");
}

/** `Resolve` and `Reopen` are the same button; only a human ever presses it. */
function StatusButton({ thread, busy }: { thread: Comment; busy: boolean }) {
  const resolved = thread.status === "resolved";
  return (
    <button
      type="button"
      className={resolved ? "ghost small" : "ok small"}
      disabled={busy}
      onClick={() => void useStore.getState().setStatus(thread.id, resolved ? "open" : "resolved")}
    >
      {resolved ? "Reopen" : "Resolve"}
    </button>
  );
}

function ThreadReply({ reply }: { reply: Reply }) {
  return (
    <div className={reply.role === "agent" ? "reply agent" : "reply"}>
      <div className="reply-head">
        <span className="reply-author">{reply.author}</span>
        <span className="reply-meta">
          {reply.role} · {relativeTime(reply.createdAt)}
        </span>
      </div>
      <p className="reply-body">{reply.body}</p>
    </div>
  );
}

function ReplyField({ id, busy }: { id: string; busy: boolean }) {
  const text = useStore((store) => store.replyText);
  const setReplyText = useStore((store) => store.setReplyText);

  // `Reply` was pressed, so the field takes the ring: a callback ref, as `autoFocus` fires once
  // per mount and not once per thread.
  const focusHere = useCallback((element: HTMLTextAreaElement | null) => element?.focus(), []);

  return (
    <form
      className="reply-form"
      aria-label="reply"
      onSubmit={(event) => {
        event.preventDefault();
        void useStore.getState().sendReply(id);
      }}
    >
      <textarea
        ref={focusHere}
        className="reply-field"
        value={text}
        aria-label="reply"
        placeholder="Ответ агенту"
        onChange={(event) => setReplyText(event.target.value)}
      />
      <div className="thread-actions">
        <button type="submit" className="primary small" disabled={busy || text.trim() === ""}>
          Send
        </button>
        <button
          type="button"
          className="ghost small"
          onClick={() => useStore.getState().openReply(null)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
