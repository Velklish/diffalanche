import { useStore } from "../store.ts";

/** The scanner warnings of handoff section 1.2, dismissed per session: a warning is about the base
 * that session resolves (08-ui.md, "The header"). */
export function WarningsBar() {
  const warnings = useStore((store) => store.warnings);
  const session = useStore((store) => store.session?.name ?? null);
  const dismissedFor = useStore((store) => store.warningsDismissedFor);
  const dismiss = useStore((store) => store.dismissWarnings);

  if (warnings.length === 0 || (session !== null && dismissedFor === session)) return null;

  return (
    <div className="warnings" role="status">
      <span className="tag scan">SCAN</span>
      <ul>
        {warnings.map((warning) => (
          <li key={`${warning.path}:${warning.message}`}>
            <b>{warning.path}</b> · {warning.message}
          </li>
        ))}
      </ul>
      <span className="spacer" />
      <button type="button" className="ghost small" onClick={dismiss}>
        dismiss
      </button>
    </div>
  );
}
