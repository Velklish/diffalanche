import { useStore } from "../store.ts";

/**
 * The scanner warnings of handoff section 1.2: what the scan and the base
 * resolution had to say, above the workspace and below the header. Dismissing
 * is per session, because a warning is about the base that session resolves and
 * the next one resolves its own.
 */
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
