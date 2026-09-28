import { useEffect, useRef, useState } from "react";
import { formatBase } from "../base.ts";
import { afterPaint } from "../perf.ts";
import { deleteQuestion, historyScopeLabel } from "../scope.ts";
import { useStore } from "../store.ts";
import { relativeTime } from "../time.ts";
import type { ReviewStatus, SessionSummary } from "../types.ts";

/** The menu of handoff section 7: the open and the closed tasks, the create form, and `Comment on
 * review`, which has nowhere else to be opened from (DA-22; 08-ui.md, "The history of tasks"). */
export function SessionMenu() {
  const sessions = useStore((store) => store.sessions);
  const shown = useStore((store) => store.session?.name ?? null);
  const switching = useStore((store) => store.switching);
  const newName = useStore((store) => store.newName);
  const newBase = useStore((store) => store.newBase);
  const setSessionMenu = useStore((store) => store.setSessionMenu);
  const openComposer = useStore((store) => store.openComposer);

  // The order inside a group is the server's own, most recently updated first, so the split is a
  // filter and never a sort ([04-domain.md](../../../docs/reference/04-domain.md)).
  const open = sessions.filter((session) => session.status !== "closed");
  const closed = sessions.filter((session) => session.status === "closed");

  // A named region and not a `menu`, which holds menu items while this holds a form
  // (08-ui.md, "The history of tasks").
  return (
    <section className="menu" aria-label="review sessions">
      <div className="menu-list">
        <SessionGroup label="Открытые задачи" sessions={open} shown={shown} switching={switching} />
        <SessionGroup label="Закрытые" sessions={closed} shown={shown} switching={switching} />
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

/** One of the two groups, not drawn when empty: an empty heading promises rows that are not
 * coming (08-ui.md, "The history of tasks"). */
function SessionGroup({
  label,
  sessions,
  shown,
  switching,
}: {
  label: string;
  sessions: SessionSummary[];
  /** The task this window is on, which is what the row's own chip says. */
  shown: string | null;
  /** A session write is in flight; every row's gesture waits for it. */
  switching: boolean;
}) {
  if (sessions.length === 0) return null;
  // The heading names the group, so no `aria-label`: a named section is a landmark, which a
  // popover of two groups has no use for.
  return (
    <section className="menu-group">
      <h2 className="menu-group-label">{label}</h2>
      {sessions.map((session) => (
        <SessionRow
          key={session.name}
          session={session}
          here={session.name === shown}
          switching={switching}
        />
      ))}
    </section>
  );
}

/** One task in the history: a container with two targets, and two chips, `ЭТО ОКНО` and `CLI`,
 * that are two facts (08-ui.md, "Two chips about where the task is, and why they are not one"). */
function SessionRow({
  session,
  here,
  switching,
}: {
  session: SessionSummary;
  here: boolean;
  switching: boolean;
}) {
  const closed = session.status === "closed";
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <DeleteQuestion session={session} switching={switching} onCancel={() => setAsking(false)} />
    );
  }
  return (
    <div className={rowClass(here, closed)}>
      <button
        type="button"
        className="session-open"
        onClick={() => void useStore.getState().switchSession(session.name)}
      >
        <span className="session-head">
          <span className="session-name">{session.name}</span>
          {here ? <span className="chip here">ЭТО ОКНО</span> : null}
          {session.current ? (
            <>
              {/* The sentence is said, not left in a `title` only a hovering pointer reaches: a
                  screen reader announces the button's text (08-ui.md, "Two chips…"). */}
              <span className="chip" title="указатель, которым пользуется CLI без --review">
                CLI
              </span>
              <span className="visually-hidden">
                — указатель, которым пользуется CLI без --review
              </span>
            </>
          ) : null}
          {closed ? <span className="chip">CLOSED</span> : null}
          {/* What the task is about, counted by the function the `SCOPE` pill counts with
              (08-ui.md, "The scope on a row…"). */}
          <span className="chip scope">{historyScopeLabel(session.scope)}</span>
          <span className="chip">{formatBase(session.base)}</span>
        </span>
        {session.title === null ? null : <span className="session-title">{session.title}</span>}
        {/* `repos changed`, not `repos`: what had changes at the last scan, not what the task is
            about (ADR-010, decision 5; 08-ui.md, "The scope on a row…"). */}
        <span className="session-metrics">
          <span>{changedLabel(session.repositories)}</span>
          <span className="crit">{session.open} open</span>
          <span className="nit">{session.resolved} resolved</span>
          <span className="tx3">updated {relativeTime(session.updatedAt)}</span>
        </span>
      </button>
      {/* A marker, not a lock, and the same press opens it again, so a ghost and not red
          (`DESIGN.md`, Buttons; 08-ui.md, "Closing a task…"). */}
      <button
        type="button"
        className="ghost small session-status"
        data-session-status={session.name}
        disabled={switching}
        onClick={() => void press(session.name, closed ? "open" : "closed")}
      >
        {closed ? "Reopen" : "Close"}
      </button>
      {/* Deleting asks first, in the row it is about (DA-40): the question replaces the row. */}
      <button
        type="button"
        className="ghost small session-status"
        data-session-delete={session.name}
        disabled={switching}
        onClick={() => setAsking(true)}
      >
        Delete
      </button>
    </div>
  );
}

/** The question before a task is deleted, in its row's place, with the ring on `Отмена` so an `⏎`
 * deletes nothing ([08-ui.md](../../../docs/reference/08-ui.md), "Deleting a task"). */
function DeleteQuestion({
  session,
  switching,
  onCancel,
}: {
  session: SessionSummary;
  switching: boolean;
  onCancel: () => void;
}) {
  const question = deleteQuestion(session.name, session.open + session.resolved, session.open);
  const cancel = useRef<HTMLButtonElement>(null);
  // Once, as the question appears: a ref that focused on every render took the ring back from
  // wherever the reader had moved it, on every keystroke in the menu's own fields.
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <fieldset className="session-row asking" aria-label={question}>
      <p className="confirm-question">{question}</p>
      <p className="confirm-note">Каталог задачи уходит с диска целиком, вернуть его нельзя.</p>
      <div className="session-confirm">
        <span className="spacer" />
        <button
          type="button"
          className="ghost small"
          ref={cancel}
          // Once `Удалить` is pressed the delete is under way, and cancelling is no longer true.
          disabled={switching}
          onClick={() => {
            onCancel();
            void afterPaint().then(() => focusDelete(session.name));
          }}
        >
          Отмена
        </button>
        <button
          type="button"
          className="primary small danger"
          disabled={switching}
          onClick={() => void remove(session.name)}
        >
          Удалить
        </button>
      </div>
    </fieldset>
  );
}

/** The delete, and the ring after it: the row it was on is gone, so it goes to the `Delete` of the
 * row that took its place — the next, else the one before — or to the create form's name field. */
async function remove(name: string): Promise<void> {
  const before = useStore.getState().sessions.map((one) => one.name);
  const at = before.indexOf(name);
  const held = document.activeElement;
  await useStore.getState().deleteTask(name);
  await afterPaint();
  // A reader who moved while the delete ran keeps where they are, as `press` has it.
  const now = document.activeElement;
  if (now !== null && now !== document.body && now !== held) return;
  const left = useStore.getState().sessions.map((one) => one.name);
  if (left.includes(name)) return;
  const next = before.slice(at + 1).find((one) => left.includes(one));
  const previous = before
    .slice(0, at)
    .reverse()
    .find((one) => left.includes(one));
  const neighbour = next ?? previous;
  if (neighbour !== undefined) focusDelete(neighbour);
  else document.querySelector<HTMLElement>('.menu-create input[aria-label="name"]')?.focus();
}

/** Back on the row's own `Delete`, where the reader was before the question. */
function focusDelete(name: string): void {
  document.querySelector<HTMLElement>(`[data-session-delete="${CSS.escape(name)}"]`)?.focus();
}

/** The gesture, and the ring after it: the row moves to the other group, so the same task's new
 * button takes it, after the paint (08-ui.md, "Closing a task…"). */
async function press(name: string, status: ReviewStatus): Promise<void> {
  const held = document.activeElement;
  await useStore.getState().setTaskStatus(name, status);
  await afterPaint();
  // On `<body>` (the button unmounted) or still on it (the write was refused) is a reader who has
  // not moved; anywhere else is one who did, and keeps where they are.
  const now = document.activeElement;
  if (now !== null && now !== document.body && now !== held) return;
  document.querySelector<HTMLElement>(`[data-session-status="${CSS.escape(name)}"]`)?.focus();
}

/** `1 repo changed` / `7 repos changed`, a dash while nothing has been scanned; it inflects like
 * the scope chip beside it (08-ui.md, "The scope on a row…"). */
function changedLabel(repositories: number | null): string {
  if (repositories === null) return "— repos changed";
  return `${repositories} ${repositories === 1 ? "repo" : "repos"} changed`;
}

function rowClass(here: boolean, closed: boolean): string {
  return ["session-row", here ? "on" : "", closed ? "closed" : ""].filter(Boolean).join(" ");
}
