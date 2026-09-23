/** Which overlay is on top and how it closes, in one place: the keyboard asks
 * rather than enumerating flags ([08-ui.md](../../docs/reference/08-ui.md)). */
import type { Store } from "./store.ts";

/** Every overlay of the workspace, topmost first. */
type OverlayName =
  | "palette"
  | "scopeConfirm"
  | "scope"
  | "newTask"
  | "base"
  | "export"
  | "sessionMenu";

/** The ladder for focus: overlays that replace each other at one position in
 * the tree share the control that opened the first of them (DA-100). */
export type Ladder = "scope" | "palette" | "base" | "export";

type Rung = {
  name: OverlayName;
  open: (store: Store) => boolean;
  close: (store: Store) => void;
};

/** The order `esc` walks: the confirmation above the editor it replaces, the
 * sessions menu last because it is a popover and not a modal. */
const LADDER: Rung[] = [
  {
    name: "palette",
    open: (store) => store.paletteOpen,
    close: (store) => store.setPalette(false),
  },
  {
    name: "scopeConfirm",
    open: (store) => store.scopeConfirm !== null,
    close: (store) => store.cancelScopeConfirm(),
  },
  { name: "scope", open: (store) => store.scopeOpen, close: (store) => store.openScope(false) },
  {
    name: "newTask",
    open: (store) => store.newTaskOpen,
    close: (store) => store.openNewTask(false),
  },
  { name: "base", open: (store) => store.baseOpen, close: (store) => store.openBase(false) },
  { name: "export", open: (store) => store.exportOpen, close: (store) => store.openExport(false) },
  {
    name: "sessionMenu",
    open: (store) => store.sessionMenuOpen,
    close: (store) => store.setSessionMenu(false),
  },
];

/** The overlay `esc` would answer, or `null` when the workspace is bare. */
export function topOverlay(store: Store): OverlayName | null {
  return LADDER.find((rung) => rung.open(store))?.name ?? null;
}

/** Closes the topmost overlay and says whether there was one. */
export function closeTopOverlay(store: Store): boolean {
  const rung = LADDER.find((one) => one.open(store));
  if (rung === undefined) return false;
  rung.close(store);
  return true;
}
