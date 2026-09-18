/** The handoff's keyboard map in one listener; the table, the rule about fields
 * and its exceptions are in [08-ui.md](../../docs/reference/08-ui.md). */
import { useEffect } from "react";
import { revealThread } from "./reveal.ts";
import { useStore } from "./store.ts";

/** How close two presses of `Shift` have to be to be one gesture. */
const DOUBLE_SHIFT_MS = 400;

export function useKeys(): void {
  useEffect(() => {
    /** When `Shift` was last pressed alone; any other key breaks the pair. */
    let lastShift = 0;

    const onKey = (event: KeyboardEvent) => {
      const store = useStore.getState();
      const inField =
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]") !== null;

      if (event.key === "Shift") {
        // Not while typing — a person writing capitals into a comment is not
        // searching — except while the modal is open, where the field it would
        // close has the focus and `⇧⇧` is documented as a toggle.
        if (event.repeat || (inField && !store.paletteOpen)) return;
        const at = event.timeStamp;
        if (at - lastShift <= DOUBLE_SHIFT_MS && lastShift > 0) {
          lastShift = 0;
          store.setPalette(!store.paletteOpen);
          return;
        }
        lastShift = at;
        return;
      }
      lastShift = 0;

      if (event.key === "Escape") {
        // The topmost thing only. Without the order, one `esc` over the search
        // modal would also throw away the comment being written under it.
        if (store.paletteOpen) {
          store.setPalette(false);
          return;
        }
        if (store.sessionMenuOpen || store.baseOpen || store.exportOpen) {
          store.setSessionMenu(false);
          store.openBase(false);
          store.openExport(false);
          return;
        }
        if (store.replyId !== null) {
          store.openReply(null);
          return;
        }
        store.closeComposer();
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        if (event.key === "k" || event.key === "K") {
          event.preventDefault();
          store.setPalette(!store.paletteOpen);
          return;
        }
        if (event.key === "Enter" && store.composer !== null) {
          event.preventDefault();
          void store.submitComment();
        }
        return;
      }
      if (event.altKey || inField) return;
      // A letter under an overlay belongs to the overlay, not to the diff
      // behind it; `esc` above is what closes one. The search field has the
      // focus while it is open, so this is also what covers a click that took
      // the focus out of it.
      if (store.paletteOpen || store.baseOpen || store.exportOpen) return;

      switch (event.key) {
        case "c":
        case "C":
          event.preventDefault();
          // A second `C` would reopen the form on the same line and throw away
          // what has been typed into it; `esc` is how it is closed.
          if (store.composer === null) store.commentOnCurrentFile();
          return;
        case "j":
        case "J":
          event.preventDefault();
          step(1);
          return;
        case "k":
        case "K":
          event.preventDefault();
          step(-1);
          return;
        case "r":
        case "R":
          event.preventDefault();
          void store.resolveFocused();
          return;
        case "[":
          event.preventDefault();
          store.toggleSidebar();
          return;
        case "]":
          event.preventDefault();
          store.toggleRail();
          return;
        case "b":
        case "B":
          event.preventDefault();
          // The handoff's `B` is browsing a repository outside the diff, which
          // is Phase 2. Saying so is the whole behaviour until DA-37.
          store.setToast("Обход репозитория — Phase 2 (DA-37)");
          return;
        default:
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/** `J` and `K`: the rail follows the focus, and so does the diff. */
function step(delta: 1 | -1): void {
  const id = useStore.getState().stepThread(delta);
  if (id !== null) void revealThread(id);
}
