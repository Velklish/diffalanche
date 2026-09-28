import { baseSummary } from "../base.ts";
import { useStore } from "../store.ts";

/** The hotkeys of the handoff's keyboard map, in the order it lists them ([keys.ts](../keys.ts)). */
const HINTS: [string, string][] = [
  ["⌘K ⇧⇧", "search"],
  ["J K", "threads"],
  ["C", "comment"],
  ["R", "resolve"],
  ["B", "browse"],
  ["[ ]", "panels"],
];

/** The 30 px bar of handoff section 1.6; the prototype's demo-state switcher is not built
 * (08-ui.md, "The header"). */
export function StatusBar() {
  const session = useStore((store) => store.session);
  const open = useStore((store) => store.counters.counters.open);
  const browse = useStore((store) => store.browse);

  return (
    <footer className="status-bar">
      {HINTS.map(([key, what]) => (
        <span className="hint" key={key}>
          <span className="key">{key}</span>
          {what}
        </span>
      ))}
      <span className="spacer" />
      <span className="context">
        {browse ? "browsing · read-only" : baseSummary(session?.base)} · {open} threads in{" "}
        {session?.name ?? "—"}
      </span>
    </footer>
  );
}
