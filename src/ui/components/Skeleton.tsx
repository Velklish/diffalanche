/** The page while the server answers: no spinner, and the panels at their final widths, so
 * nothing moves when the data arrives (08-ui.md, "Loading"). */

const ROWS = [0.82, 0.54, 0.71, 0.46, 0.63, 0.78, 0.51, 0.68];

export function SidebarSkeleton() {
  return (
    <div className="tree skeleton" aria-hidden="true">
      {ROWS.map((width, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
        <span key={row} className="skeleton-row" style={{ width: `${width * 100}%` }} />
      ))}
    </div>
  );
}

export function FileCardSkeleton() {
  return (
    <div className="file-card skeleton" aria-hidden="true">
      <div className="file-head">
        <span className="skeleton-row" style={{ width: 220 }} />
      </div>
      <div className="file-body" />
    </div>
  );
}
