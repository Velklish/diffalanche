import { useEffect, useRef } from "react";
import { baseLabel } from "../base.ts";
import { countScope, scopeLabel } from "../scope.ts";
import { useStore } from "../store.ts";
import { Logo } from "./Logo.tsx";
import { SessionMenu } from "./SessionMenu.tsx";

/**
 * The 52 px bar of handoff section 1.1: the session pill and its menu, the base
 * picker, the two counters that filter the rail, search, the theme toggle, and
 * the export, and the search that opens the modal of DA-26.
 */
export function Header() {
  const session = useStore((store) => store.session);
  const counters = useStore((store) => store.counters.counters);
  const theme = useStore((store) => store.theme);
  const setTheme = useStore((store) => store.setTheme);
  const menuOpen = useStore((store) => store.sessionMenuOpen);
  const setSessionMenu = useStore((store) => store.setSessionMenu);
  const openBase = useStore((store) => store.openBase);
  const filterRail = useStore((store) => store.filterRail);
  const openExport = useStore((store) => store.openExport);
  const pill = useRef<HTMLSpanElement>(null);

  // A press anywhere outside the pill and its menu closes it. The pill itself
  // is inside, so pressing it a second time is its own toggle rather than a
  // close followed by an immediate reopen.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && pill.current?.contains(target)) return;
      setSessionMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen, setSessionMenu]);

  return (
    <header className="header">
      <span className="brand">
        <Logo />
        <span className="brand-word">diffalanche</span>
      </span>

      <span className="pill-holder" ref={pill}>
        <button
          type="button"
          className="pill"
          aria-expanded={menuOpen}
          onClick={() => setSessionMenu(!menuOpen)}
        >
          <span className="pill-name">{session?.name ?? "no session"}</span>
          <span className="pill-title">{session?.title ?? ""}</span>
          <HistoryMark />
          <span className="caret">▾</span>
        </button>
        {menuOpen ? <SessionMenu /> : null}
      </span>

      <button
        type="button"
        className="pill base"
        aria-haspopup="dialog"
        onClick={() => openBase(true)}
      >
        <span className="tag">BASE</span>
        <span className="pill-name">{baseLabel(session?.base)}</span>
        <span className="caret">▾</span>
      </button>

      <ScopePill />

      <span className="spacer" />

      <button type="button" className="counter" onClick={() => filterRail("open")}>
        <span className="dot crit" />
        <b className="crit">{counters.open}</b> open
      </button>
      <button type="button" className="counter" onClick={() => filterRail("awaiting")}>
        <span className="dot acc" />
        <b className="acc">{counters.awaiting}</b> awaiting you
      </button>

      <button
        type="button"
        className="ghost"
        aria-label="search"
        onClick={() => useStore.getState().setPalette(true)}
      >
        ⌕<span className="key">⌘K</span>
      </button>

      <span className="segments">
        <button
          type="button"
          className={theme === "dark" ? "segment on" : "segment"}
          aria-pressed={theme === "dark"}
          aria-label="dark theme"
          onClick={() => setTheme("dark")}
        >
          ☾
        </button>
        <button
          type="button"
          className={theme === "light" ? "segment on" : "segment"}
          aria-pressed={theme === "light"}
          aria-label="light theme"
          onClick={() => setTheme("light")}
        >
          ☀
        </button>
      </span>

      <button type="button" className="ghost" onClick={() => openExport(true)}>
        Export .md
      </button>
    </header>
  );
}

/**
 * The quiet mark of handoff section 1.1: a task appeared in the data directory,
 * or one was closed or reopened, while this window was open. It is a dot on the
 * pill that opens the history and **nothing else** — no toast, no switch, no
 * scroll, and nothing that closes a composer the reader is writing in. They go
 * on reading and open the task when they are ready; opening the menu clears it
 * (DA-56).
 *
 * It is `.dot`, the system's status dot, and not a shape of its own: the 7 px
 * status dot is the only circle `DESIGN.md` allows, and a second round
 * primitive beside it would be a change to the visual contract rather than a
 * mark (`DESIGN.md`, Shapes).
 *
 * The dot is not the news itself, so the sentence goes to a screen reader,
 * which has no dot to read.
 */
function HistoryMark() {
  const marked = useStore((store) => store.historyMark);
  if (!marked) return null;
  return (
    <>
      <span className="dot acc pill-mark" />
      <span className="visually-hidden">в истории появилась задача</span>
    </>
  );
}

/**
 * The `SCOPE` pill of handoff section 1.1, beside `BASE` and the same control
 * shape: what this review task is about, and the way into the editor that
 * changes it.
 *
 * **A session with no scope has no pill at all.** It is about the whole root,
 * which is what a session has always been, and a pill saying so would be a
 * control for a state that is not a narrowing
 * ([ADR-010](../../../docs/adr/adr-010-review-task-scope.md)).
 */
function ScopePill() {
  const scope = useStore((store) => store.session?.scope ?? null);
  const openScope = useStore((store) => store.openScope);
  if (scope === null) return null;

  return (
    <button
      type="button"
      className="pill scope"
      aria-haspopup="dialog"
      onClick={() => openScope(true)}
    >
      <span className="tag">SCOPE</span>
      <span className="pill-name">{scopeLabel(countScope(scope))}</span>
      <span className="caret">▾</span>
    </button>
  );
}
