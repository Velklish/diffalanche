/** Fuzzy matching of a symbol name against a query: the whole name first, then its start, then
 * anywhere in it, then its letters in order ([09-ml.md](../../../../docs/reference/09-ml.md)). */

const EXACT = 1000;
const PREFIX = 800;
const INSIDE = 600;
const SPREAD = 300;

/** How well `name` answers `query`, or 0 when it does not; both are compared without case. */
export function matchScore(name: string, query: string): number {
  const lower = name.toLowerCase();
  const needle = query.toLowerCase();
  if (needle === "") return 0;
  if (lower === needle) return EXACT;
  // A shorter name that starts with the query is closer to it than a longer one.
  if (lower.startsWith(needle)) return PREFIX - (lower.length - needle.length);
  const at = lower.indexOf(needle);
  if (at >= 0) return INSIDE - at;
  // Letters in order with gaps: `ctrlsvc` finds `ControllerService`; each gap costs a point.
  let from = 0;
  let gaps = 0;
  for (const char of needle) {
    const found = lower.indexOf(char, from);
    if (found < 0) return 0;
    gaps += found - from;
    from = found + 1;
  }
  return Math.max(1, SPREAD - gaps);
}
