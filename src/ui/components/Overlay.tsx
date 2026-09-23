import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { Ladder } from "../overlays.ts";

/** The scrim and panel of the handoff: the ring held inside, given back to
 * whatever opened the ladder, and `esc` owned by `keys.ts` (08-ui.md). */
export function Overlay({
  width,
  label,
  className,
  ladder,
  onClose,
  children,
}: {
  width: number;
  label: string;
  /** What the panel is besides an overlay; global search is the tall one. */
  className?: string;
  /** Overlays that replace each other at one position share an opener (DA-100). */
  ladder: Ladder;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Recorded while the overlay renders, not in the effect: a child that focuses
  // itself as it mounts — the search field does — runs before effects.
  const entered = useRef(false);
  if (!entered.current) {
    entered.current = true;
    enterLadder(ladder);
  }

  useFocusHeld(panel, ladder);

  return (
    <div className="scrim">
      {/*
        The scrim closes on a click but is not a stop on the way round: it fills
        the window and shows nothing, so a ring that landed on it would look
        like a ring that had gone nowhere.
      */}
      <button
        type="button"
        className="scrim-hit"
        aria-label="close"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className={className === undefined ? "overlay" : `overlay ${className}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // So there is something to focus in a panel whose contents are not
        // focusable, and something to hold the ring against.
        tabIndex={-1}
        ref={panel}
      >
        {children}
      </div>
    </div>
  );
}

/** The control that opened a ladder, and the restore owed to it once the ladder
 * has emptied ([08-ui.md](../../../docs/reference/08-ui.md), DA-100). */
const OPENERS = new Map<Ladder, Element | null>();
const MOUNTED = new Map<Ladder, number>();

/** The first overlay of a ladder records the opener; a swap keeps it. */
function enterLadder(ladder: Ladder): void {
  if (!OPENERS.has(ladder)) OPENERS.set(ladder, document.activeElement);
}

function held(ladder: Ladder, by: 1 | -1): void {
  MOUNTED.set(ladder, (MOUNTED.get(ladder) ?? 0) + by);
}

/** Read after the commit, not during it: React renders the arriving overlay
 * before it cleans up the leaving one, so a swap is only visible afterwards. */
function leaveLadder(ladder: Ladder): void {
  setTimeout(() => {
    if ((MOUNTED.get(ladder) ?? 0) > 0) return;
    const back = OPENERS.get(ladder) ?? null;
    OPENERS.delete(ladder);
    // An opener that is gone or disabled cannot hold it; the header's control for the ladder can.
    if (takes(back) || takes(document.querySelector(`[data-ladder="${ladder}"]`))) return;
    console.warn(`the ${ladder} overlay closed and no control could take the focus back`);
  }, 0);
}

/** Asked of the document rather than guessed: `isConnected` passes a disabled
 * control, and `focus()` on one does nothing. */
function takes(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

/** The header control that opens a ladder: where the ring goes when its opener cannot take it. */
export function ladderHome(ladder: Ladder): { "data-ladder": Ladder } {
  return { "data-ladder": ladder };
}

/** Everything inside the panel a `Tab` can land on, in the order it would. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** The ring inside the panel; the listener is on the document because a click
 * behind the scrim can take the focus out of a panel that cannot catch it back. */
function useFocusHeld(panel: { current: HTMLDivElement | null }, ladder: Ladder): void {
  useEffect(() => {
    held(ladder, 1);
    const element = panel.current;
    // The panel itself, so the first `Tab` goes inside — unless something in it
    // has already taken the focus, which the search field does as it mounts.
    if (element !== null && !element.contains(document.activeElement)) {
      element.focus({ preventScroll: true });
    }

    const hold = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || element === null) return;
      const stops = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (one) => one.offsetParent !== null || one === document.activeElement,
      );
      const first = stops[0];
      const last = stops.at(-1);
      if (first === undefined || last === undefined) {
        // Nothing to move to: the panel keeps it.
        event.preventDefault();
        element.focus({ preventScroll: true });
        return;
      }
      const at = document.activeElement;
      if (!element.contains(at)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (!event.shiftKey && at === last) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && (at === first || at === element)) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener("keydown", hold);
    return () => {
      document.removeEventListener("keydown", hold);
      // Back where it came from, once the ladder has emptied: closing an
      // overlay must not leave the reader with no ring at all.
      held(ladder, -1);
      leaveLadder(ladder);
    };
  }, [panel, ladder]);
}
