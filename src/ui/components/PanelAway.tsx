import { useStore } from "../store.ts";

/** Takes a side panel off the screen, from that panel's own top row; the arrow
 * points the way it leaves and the header keeps the way back (DA-107). */
export function PanelAway({ side }: { side: "sidebar" | "rail" }) {
  const toggle = useStore((store) => (side === "sidebar" ? store.toggleSidebar : store.toggleRail));
  return (
    <button
      type="button"
      className="panel-toggle"
      aria-label={side === "sidebar" ? "hide the navigation" : "hide the threads"}
      onClick={toggle}
    >
      {side === "sidebar" ? "‹" : "›"}
    </button>
  );
}
