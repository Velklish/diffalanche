import { useEffect } from "react";
import { useStore } from "../store.ts";

/** Bottom centre, 2.2 seconds, as the handoff's "Тосты" says, for a text as short as the ones it
 * drew; each character past them adds a reader's 50 ms, up to 10 s (DA-102.1, 08-ui.md). */
const LIFETIME_MS = 2200;
const SHORT_CHARACTERS = 60;
const PER_CHARACTER_MS = 50;
const LONGEST_MS = 10_000;

export function lifetime(text: string): number {
  const over = Math.max(0, text.length - SHORT_CHARACTERS);
  return Math.min(LONGEST_MS, LIFETIME_MS + over * PER_CHARACTER_MS);
}

export function Toast() {
  const toast = useStore((store) => store.toast);
  const setToast = useStore((store) => store.setToast);

  // On the raise and not on the text: the same sentence said twice is two
  // toasts, and the second one starts its own lifetime (DA-105).
  const seq = toast?.seq ?? null;
  const ms = toast === null ? null : lifetime(toast.text);
  useEffect(() => {
    if (seq === null || ms === null) return;
    const timer = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(timer);
  }, [seq, ms, setToast]);

  if (toast === null) return null;
  return (
    <div className="toast" role="status">
      {toast.text}
    </div>
  );
}
