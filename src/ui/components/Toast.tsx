import { useEffect } from "react";
import { useStore } from "../store.ts";

/** Bottom centre, 2.2 seconds, as the handoff's "Тосты" says. */
const LIFETIME_MS = 2200;

export function Toast() {
  const toast = useStore((store) => store.toast);
  const setToast = useStore((store) => store.setToast);

  // On the raise and not on the text: the same sentence said twice is two
  // toasts, and the second one starts its own 2.2 seconds (DA-105).
  const seq = toast?.seq ?? null;
  useEffect(() => {
    if (seq === null) return;
    const timer = setTimeout(() => setToast(null), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [seq, setToast]);

  if (toast === null) return null;
  return (
    <div className="toast" role="status">
      {toast.text}
    </div>
  );
}
