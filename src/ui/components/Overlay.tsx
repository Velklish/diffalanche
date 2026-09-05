import type { ReactNode } from "react";
import { useEffect } from "react";

/**
 * The overlay primitive of the handoff: a scrim that closes on a click and on
 * `esc`, a panel that does not. DA-24 and DA-26 put the base picker, the
 * sessions menu, the export, and global search inside it.
 */
export function Overlay({
  width,
  label,
  onClose,
  children,
}: {
  width: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="scrim">
      <button type="button" className="scrim-hit" aria-label="close" onClick={onClose} />
      <div className="overlay" style={{ width }} role="dialog" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
