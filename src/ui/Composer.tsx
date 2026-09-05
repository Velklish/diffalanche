/** The placeholder the spike opens where Phase 1 will put the real composer. */
export function Composer({ label }: { label: string }) {
  return (
    <div className="composer" data-testid="composer">
      <div>→ {label}</div>
      <textarea readOnly placeholder="Что не так с этими строками?" />
    </div>
  );
}
