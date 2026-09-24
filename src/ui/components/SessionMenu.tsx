import { useEffect, useRef, useState } from "react";
import { formatBase } from "../base.ts";
import { afterPaint } from "../perf.ts";
import { deleteQuestion, historyScopeLabel } from "../scope.ts";
import { useStore } from "../store.ts";
import { relativeTime } from "../time.ts";
import type { ReviewStatus, SessionSummary } from "../types.ts";

/**
 * The menu of handoff section 7: the history of review tasks. Two groups —
 * the open tasks and, under them, the closed ones — each row with its base, its
 * scope, its counters, and the gesture that closes it or opens it again. The
 * form that creates the next task is at the foot, and `Comment on review` is
 * here as well: it is the one anchor level that belongs to no repository and so
 * has nowhere else to be opened from (DA-22).
 */
export function SessionMenu() {
  const sessions = useStore((store) => store.sessions);
  const shown = useStore((store) => store.session?.name ?? null);
  const switching = useStore((store) => store.switching);
  const newName = useStore((store) => store.newName);
  const newBase = useStore((store) => store.newBase);
  const setSessionMenu = useStore((store) => store.setSessionMenu);
  const openComposer = useStore((store) => store.openComposer);

  // The order inside a group is the server's own — most recently updated first
  // ([04-domain.md](../../../docs/reference/04-domain.md)) — so the split is a
  // filter and never a sort.
  const open = sessions.filter((session) => session.status !== "closed");
  const closed = sessions.filter((session) => session.status === "closed");

  // A `menu` holds menu items, and this one holds a form: the roles would be
  // a lie to a screen reader. A named region says what it is and lets it carry
  // whatever the handoff draws in it.
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

/**
 * One of the two groups. A group with nothing in it is not drawn: an empty
 * heading would be a promise of rows that are not coming, and a root where
 * nothing has been closed yet is the ordinary state rather than a state worth
 * announcing.
 */
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
  // The heading is what names the group, so the section takes no `aria-label`
  // of its own: the two would be one thing said twice, and a named section is a
  // landmark, which a popover of two groups has no use for.
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

/**
 * One task in the history. The row is a container with two targets, the way a
 * thread card is: the whole readable body switches this window to the task, and
 * the status gesture beside it is its own button. A nested button would be
 * neither valid markup nor reachable by keyboard.
 *
 * **The two chips say two different things and are not one chip.** `ЭТО ОКНО`
 * is the task *this window* is showing. `CLI` is the pointer a terminal beside
 * it uses without `--review`, and it is written as the pointer rather than as
 * `CURRENT`, because in a list of tasks that word reads as "the main one" and
 * there is no main task ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md),
 * decision 7). Both on one row is an ordinary state, not an edge.
 */
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
              {/*
                Three letters carry less than the sentence behind them, so the
                sentence is said rather than left in a `title` a pointer has to
                hover to reach: a `title` on a span is neither reachable from
                the keyboard nor read out by a screen reader, which announces
                the text of the button this sits in.
              */}
              <span className="chip" title="указатель, которым пользуется CLI без --review">
                CLI
              </span>
              <span className="visually-hidden">
                — указатель, которым пользуется CLI без --review
              </span>
            </>
          ) : null}
          {closed ? <span className="chip">CLOSED</span> : null}
          {/*
            What the task is about, counted as the scope is written and by the
            same function the `SCOPE` pill counts with, so the two numbers about
            one thing cannot disagree ([08-ui.md](../../../docs/reference/08-ui.md)).
          */}
          <span className="chip scope">{historyScopeLabel(session.scope)}</span>
          <span className="chip">{formatBase(session.base)}</span>
        </span>
        {session.title === null ? null : <span className="session-title">{session.title}</span>}
        {/*
          `repos changed` and not `repos`: the scope chip above counts the
          repositories the task **is about**, and this counts the ones that had
          changes at the last scan. They are two numbers about two things, and
          one word for both would read as a contradiction on the row where a
          file of the scope has stopped changing (ADR-010, decision 5).
        */}
        <span className="session-metrics">
          <span>{changedLabel(session.repositories)}</span>
          <span className="crit">{session.open} open</span>
          <span className="nit">{session.resolved} resolved</span>
          <span className="tx3">updated {relativeTime(session.updatedAt)}</span>
        </span>
      </button>
      {/*
        Closing is a marker and not a lock — a closed task still takes comments,
        replies and resolves — and the same press opens it again, so it is a
        ghost button and not the red one the scope editor's confirmation has
        (`DESIGN.md`, Buttons). Only a human ever presses it: the server signs
        the write with `config.user` and `role: human` and takes nothing from
        the request.
      */}
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

/**
 * The gesture, and the focus after it. The row is re-rendered into the *other*
 * group, so the button that was pressed unmounts and the ring would fall to the
 * document — inside an open popover, which is where a keyboard reader would
 * then have to find their way back from. The button of the same task in its new
 * group takes it instead, which is where the reader was.
 *
 * `afterPaint` and not the promise alone: the store is written when
 * `setTaskStatus` resolves, and React has not necessarily flushed the render
 * that moves the row by then. The new button does not exist until it has.
 */
async function press(name: string, status: ReviewStatus): Promise<void> {
  const held = document.activeElement;
  await useStore.getState().setTaskStatus(name, status);
  await afterPaint();
  // Where the ring went while the write was in flight decides this. It is on
  // the body when the pressed button was unmounted under it, and still on that
  // button when the write was refused and the row stayed where it was; either
  // is the reader not having moved. Anything else is a reader who did move —
  // the menu closes on a press outside it, and `Tab` walks on — and dragging
  // them back to a row they have left is worse than a ring they can see.
  const now = document.activeElement;
  if (now !== null && now !== document.body && now !== held) return;
  document.querySelector<HTMLElement>(`[data-session-status="${CSS.escape(name)}"]`)?.focus();
}

/**
 * `1 repo changed` / `7 repos changed`, and a dash while nothing has been
 * scanned. It counts like the scope chip beside it because the two sit on one
 * row and a singular next to a plural of the same word reads as a defect —
 * even though the two numbers are deliberately about different things.
 */
function changedLabel(repositories: number | null): string {
  if (repositories === null) return "— repos changed";
  return `${repositories} ${repositories === 1 ? "repo" : "repos"} changed`;
}

function rowClass(here: boolean, closed: boolean): string {
  return ["session-row", here ? "on" : "", closed ? "closed" : ""].filter(Boolean).join(" ");
}
