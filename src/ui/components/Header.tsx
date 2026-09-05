import { useStore } from "../store.ts";
import type { Base } from "../types.ts";
import { Logo } from "./Logo.tsx";

/**
 * The 52 px bar of handoff section 1.1. The theme toggle works here; the
 * session pill, the base picker, the counters' filter, search, and the export
 * become interactive in DA-24 and DA-26.
 */
export function Header() {
  const session = useStore((store) => store.session);
  const counters = useStore((store) => store.counters);
  const theme = useStore((store) => store.theme);
  const setTheme = useStore((store) => store.setTheme);

  return (
    <header className="header">
      <span className="brand">
        <Logo />
        <span className="brand-word">diffalanche</span>
      </span>

      <button type="button" className="pill" disabled>
        <span className="pill-name">{session?.name ?? "no session"}</span>
        <span className="pill-title">{session?.title ?? ""}</span>
        <span className="caret">▾</span>
      </button>

      <button type="button" className="pill base" disabled>
        <span className="tag">BASE</span>
        <span className="pill-name">{baseLabel(session?.base)}</span>
        <span className="caret">▾</span>
      </button>

      <span className="spacer" />

      <span className="counter">
        <span className="dot crit" />
        <b className="crit">{counters.open}</b> open
      </span>
      <span className="counter">
        <span className="dot acc" />
        <b className="acc">{counters.awaiting}</b> awaiting you
      </span>

      <button type="button" className="ghost" disabled>
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

      <button type="button" className="ghost" disabled>
        Export .md
      </button>
    </header>
  );
}

function baseLabel(base: Base | undefined): string {
  if (!base) return "—";
  if (base.mode === "head") return "HEAD";
  if (base.mode === "ref") return base.ref ?? "ref";
  return base.branch ?? "default branch";
}
