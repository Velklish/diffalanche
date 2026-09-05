import { baseSummary } from "../base.ts";
import { useStore } from "../store.ts";

/**
 * The hotkeys of the handoff's keyboard map, in the order it lists them. Every
 * one of them does something — `B` says that browsing is Phase 2 and does
 * nothing else ([keys.ts](../keys.ts)).
 */
const HINTS: [string, string][] = [
  ["⌘K ⇧⇧", "search"],
  ["J K", "threads"],
  ["C", "comment"],
  ["R", "resolve"],
  ["B", "browse"],
];

/**
 * The 30 px bar of handoff section 1.6: the hotkeys on the left, and on the
 * right what this review is being read against. The prototype's demo-state
 * switcher sat there too; it is a prototype affordance and is not built.
 */
export function StatusBar() {
  const session = useStore((store) => store.session);
  const open = useStore((store) => store.counters.counters.open);

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
        {baseSummary(session?.base)} · {open} threads in {session?.name ?? "—"}
      </span>
    </footer>
  );
}
