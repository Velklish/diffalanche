/**
 * Relative time, as every timestamp on the screen is written: `12m ago`. The
 * handoff recomputes it every five seconds, so it is a pure function of the
 * moment it is asked for rather than of the moment the thread was written.
 */

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
