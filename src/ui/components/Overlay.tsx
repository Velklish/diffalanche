import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/**
 * The overlay primitive of the handoff: a scrim that closes on a click and on
 * `esc`, a panel that does not. The base picker, the export and global search
 * are inside it.
 *
 * It also holds the focus while it is open (DA-26.1). An overlay that does not
 * is an overlay a reader can `Tab` out of, into a page they cannot see and
 * cannot click: the ring cycles inside the panel, and when the overlay closes —
 * by `esc`, by the scrim, or by finishing what it was for — the focus goes back
 * to the control that opened it.
 */
export function Overlay({
  width,
  label,
  className,
  onClose,
  children,
}: {
  width: number;
  label: string;
  /** What the panel is besides an overlay; global search is the tall one. */
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Taken while the overlay renders, not in the effect: a child that focuses
  // itself as it mounts — the search field does — runs before effects, and by
  // then the control that opened the overlay is no longer the active element.
  const opener = useRef<Element | null>(null);
  opener.current ??= document.activeElement;

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  useFocusHeld(panel, opener);

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

/** Everything inside the panel a `Tab` can land on, in the order it would. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The ring inside the panel, and the focus given back on the way out. The
 * listener is on the document rather than on the panel, because the focus may
 * already have left it — a click on the page behind the scrim is what does that
 * — and a panel that has lost the ring can no longer catch it.
 */
function useFocusHeld(
  panel: { current: HTMLDivElement | null },
  opener: { current: Element | null },
): void {
  useEffect(() => {
    const element = panel.current;
    // The panel itself, so the first `Tab` moves to the first control inside it
    // rather than to whatever follows the overlay in the document — unless
    // something inside has already taken the focus, which is what the search
    // field does the moment it mounts.
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
      // Back where it came from: closing an overlay must not leave the reader
      // with no ring at all.
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [panel, opener]);
}
