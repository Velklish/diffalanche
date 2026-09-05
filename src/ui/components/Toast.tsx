import { useEffect } from "react";
import { useStore } from "../store.ts";

/** Bottom centre, 2.2 seconds, as the handoff's "Тосты" says. */
const LIFETIME_MS = 2200;

export function Toast() {
  const toast = useStore((store) => store.toast);
  const setToast = useStore((store) => store.setToast);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  if (toast === null) return null;
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  );
}
