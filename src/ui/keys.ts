/**
 * The keyboard map of `docs/design/HANDOFF.md`, in one place. The controller is
 * one listener on the document; what each key does is an action of the store,
 * so the map is a table of names rather than a place where behaviour lives.
 *
 * The handoff's rule about fields holds here: a letter typed into an `input` or
 * a `textarea` is text and not a command. `⌘⏎` and `esc` are commands wherever
 * they are pressed — the field is exactly where the reviewer is when they send
 * — and so is `⌘K`. `⇧⇧` is not: it is not in the handoff's exception list, and
 * a person typing capitals in a comment is not searching.
 *
 * | Key | What it does |
 * |---|---|
 * | `⌘K` / `Ctrl+K` | opens and closes global search |
 * | `⇧⇧` | the same, two presses inside 400 ms; outside a field, or in the modal's own |
 * | `↑` `↓` `⏎` in search | the modal's own field owns them ([components/GlobalSearch.tsx]) |
 * | `J` / `K` | the next and previous open thread of the whole review |
 * | `C` | the composer on the first added line of the file being read |
 * | `R` | resolves the focused thread |
 * | `B` | Phase 2 (DA-37): says so and does nothing |
 * | `↑` `↓` `TAB` in the composer | the suggestions they move through are Phase 2 (DA-35) |
 * | `⌘⏎` | sends the comment |
 * | `⏎` in the base picker | the picker owns its own field |
 * | `esc` | closes the topmost thing that is open |
 */
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
