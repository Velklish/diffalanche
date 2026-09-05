import { memo, useCallback } from "react";
import { isAwaiting } from "../../core/domain/counters.ts";
import { threadAnchor } from "../anchor.ts";
import type { RailScope } from "../store.ts";
import { useStore } from "../store.ts";
import { relativeTime } from "../time.ts";
import type { Comment, Reply } from "../types.ts";

/**
 * One thread, as handoff section 3 draws it: the severity chip, the anchor, the
 * state, the body, the replies coloured by role, and `Resolve` / `Reopen` and
 * `Reply`. The rail and the widget under the anchored line are the same card;
 * `scope` is only what the anchor is spelled with.
 *
 * `orphaned` and the `auto` / `labelled by` markers are drawn by the phases
 * that produce them — re-anchoring (DA-43) and the model (DA-36).
 */
export const ThreadCard = memo(function ThreadCard({
  thread,
  scope,
  onFocus,
}: {
  thread: Comment;
  scope: RailScope;
  /** What focusing this card means where it is shown: the rail also scrolls the diff. */
  onFocus: (id: string) => void;
}) {
  const focused = useStore((store) => store.focusId === thread.id);
  const replying = useStore((store) => store.replyId === thread.id);
  const busy = useStore((store) => store.busy[thread.id] === true);

  const resolved = thread.status === "resolved";
  const state = resolved ? "RESOLVED" : isAwaiting(thread) ? "awaiting" : null;

  return (
    // The card is a region the reader points at, and everything inside it that
    // does something is a button of its own; the focus click is on the header
    // rather than on the card, so selecting the body text does not move it.
    <article
      className={cardClass(focused, resolved)}
      data-thread={thread.id}
      aria-current={focused ? "true" : undefined}
    >
      <button type="button" className="thread-head" onClick={() => onFocus(thread.id)}>
        <span className={`sev-tag ${thread.severity}`}>{thread.severity.toUpperCase()}</span>
        <span className="thread-anchor">{threadAnchor(thread, scope)}</span>
        <span className="spacer" />
        {state === null ? null : (
          <span className={resolved ? "thread-state resolved" : "thread-state awaiting"}>
            {state}
          </span>
        )}
      </button>

      <p className="thread-body">{thread.body}</p>

      {thread.replies.map((reply) => (
        <ThreadReply key={reply.id} reply={reply} />
      ))}

      <div className="thread-actions">
        <StatusButton thread={thread} busy={busy} />
        <button
          type="button"
          className="ghost small"
          onClick={() => useStore.getState().openReply(replying ? null : thread.id)}
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

  // The field opened because `Reply` was pressed, so it is where the reader
  // already is; a callback ref rather than `autoFocus`, which fires once per
  // mount and not once per thread.
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
