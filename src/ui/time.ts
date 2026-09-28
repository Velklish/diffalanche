/** Relative time, as every timestamp on the screen is written (`12m ago`): a pure function of the
 * moment it is asked for, because the handoff recomputes it every five seconds. */

const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const ago = now - at;
  // A clock that is a little behind the file's own stamp reads as "just now"
  // rather than as a time in the future.
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  return `${Math.floor(ago / DAY)}d ago`;
}

/** The same clock in seconds for the feed and the changed-hunk marker (`<файл> · 12s ago`): a
 * hunk that changed a moment ago is exactly what "just now" would hide. */
export function elapsed(at: number, now: number = Date.now()): string {
  const ago = Math.max(0, now - at);
  if (ago < MINUTE) return `${Math.floor(ago / SECOND)}s ago`;
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  return `${Math.floor(ago / DAY)}d ago`;
}
