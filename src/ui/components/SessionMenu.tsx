import { formatBase } from "../base.ts";
import { useStore } from "../store.ts";
import { relativeTime } from "../time.ts";
import type { SessionSummary } from "../types.ts";

/**
 * The menu of handoff section 7: the history of review sessions with their
 * metrics, the current one on `--accBg` with a `CURRENT` chip, and the form
 * that creates the next one. `Comment on review` is here as well — it is the
 * one anchor level that belongs to no repository and so has nowhere else to be
 * opened from (DA-22).
 */
export function SessionMenu() {
  const sessions = useStore((store) => store.sessions);
  const current = useStore((store) => store.session?.name ?? null);
  const switching = useStore((store) => store.switching);
  const newName = useStore((store) => store.newName);
  const newBase = useStore((store) => store.newBase);
  const setSessionMenu = useStore((store) => store.setSessionMenu);
  const openComposer = useStore((store) => store.openComposer);

  // A `menu` holds menu items, and this one holds a form: the roles would be
  // a lie to a screen reader. A named region says what it is and lets it carry
  // whatever the handoff draws in it.
  return (
    <section className="menu" aria-label="review sessions">
      <div className="menu-list">
        {sessions.map((session) => (
          <SessionRow key={session.name} session={session} current={session.name === current} />
        ))}
      </div>

      <button
        type="button"
        className="menu-row"
        onClick={() => {
          setSessionMenu(false);
          openComposer({ repo: null, path: null, side: null, line: null });
        }}
      >
        Comment on review
      </button>

      <form
        className="menu-create"
        aria-label="new review session"
        onSubmit={(event) => {
          event.preventDefault();
          void useStore.getState().createSession();
        }}
      >
        <input
          value={newName}
          placeholder="ls-240588"
          aria-label="name"
          onChange={(event) => useStore.getState().setNewName(event.target.value)}
        />
        <input
          className="menu-base"
          value={newBase}
          placeholder="head"
          aria-label="base"
          onChange={(event) => useStore.getState().setNewBase(event.target.value)}
        />
        <button
          type="submit"
          className="primary small"
          disabled={switching || newName.trim() === ""}
        >
          Create
        </button>
      </form>
      {/* The grammar is the CLI's own, so one base is written one way everywhere. */}
      <div className="menu-hint">head · branch · branch:origin/develop · v0.3.1</div>
    </section>
  );
}

function SessionRow({ session, current }: { session: SessionSummary; current: boolean }) {
  return (
    <button
      type="button"
      className={current ? "session-row on" : "session-row"}
      onClick={() => void useStore.getState().switchSession(session.name)}
    >
      <span className="session-head">
        <span className="session-name">{session.name}</span>
        {current ? <span className="chip current">CURRENT</span> : null}
        <span className="chip">{formatBase(session.base)}</span>
        <span className="spacer" />
      </span>
      {session.title === null ? null : <span className="session-title">{session.title}</span>}
      <span className="session-metrics">
        <span>{session.repositories ?? "—"} repos</span>
        <span className="crit">{session.open} open</span>
        <span className="nit">{session.resolved} resolved</span>
        <span className="tx3">updated {relativeTime(session.updatedAt)}</span>
      </span>
    </button>
  );
}
