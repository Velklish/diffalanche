import { useEffect, useRef } from "react";
import { baseLabel } from "../base.ts";
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
