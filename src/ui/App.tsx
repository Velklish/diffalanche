import { useCallback, useEffect, useLayoutEffect } from "react";
import { firstAddedLine } from "./anchor.ts";
import { BasePicker } from "./components/BasePicker.tsx";
import { CentrePanel } from "./components/CentrePanel.tsx";
import { ExportModal } from "./components/ExportModal.tsx";
import { Header } from "./components/Header.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ThreadRail } from "./components/ThreadRail.tsx";
import { Toast } from "./components/Toast.tsx";
import { WarningsBar } from "./components/WarningsBar.tsx";
import { afterPaint, perf } from "./perf.ts";
import { useStore } from "./store.ts";

export function App() {
  const theme = useStore((store) => store.theme);
  const status = useStore((store) => store.status);
  const files = useStore((store) => store.files);
  const dragging = useStore((store) => store.dragging);
  const loadReview = useStore((store) => store.loadReview);
  const openComposerAt = useStore((store) => store.openComposer);

  // Before paint, so a light-theme reload never flashes the dark palette.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  // The drag ends wherever the button is let go, which is often outside the
  // card it started in — and, on a long file, outside the diff altogether.
  useEffect(() => {
    if (!dragging) return;
    const end = () => useStore.getState().endSelect();
    document.addEventListener("mouseup", end);
    // A button let go outside the window sends no `mouseup` here, and a drag
    // that never ends leaves the whole page unselectable.
    document.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      document.removeEventListener("mouseup", end);
      document.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [dragging]);

  useKeys();

  const openComposer = useCallback(async () => {
    const entry = files[0];
    if (!entry) throw new Error("the review has no files");
    const start = performance.now();
    openComposerAt({
      repo: entry.repo,
      path: entry.file.path,
      side: "new",
      line: firstAddedLine(entry.file.patch),
    });
    const painted = await afterPaint();
    return painted - start;
  }, [files, openComposerAt]);

  /**
   * The swap of a review session, measured the way the first render is: from
   * the moment the new review was parsed to the frame that showed it. The
   * request itself is the server reading a change set, which is not what
   * `docs/SPEC.md` section 6 budgets a session switch at 100 ms for — what the
   * reader waits on there is the whole set of threads, counters and badges
   * changing at once.
   */
  const switchSession = useCallback(async (name: string) => {
    await useStore.getState().switchSession(name);
    if (useStore.getState().session?.name !== name) {
      throw new Error(`the session did not switch to ${name}`);
    }
    const painted = await afterPaint();
    return perf.responseAt === null ? Number.NaN : painted - perf.responseAt;
  }, []);

  const jumpToFile = useCallback(async (index: number) => {
    const target = document.querySelector(`[data-file-index="${index}"]`);
    if (!target) throw new Error(`no file card ${index}`);
    const start = performance.now();
    target.scrollIntoView();
    const painted = await afterPaint();
    return painted - start;
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    perf.openComposer = openComposer;
    perf.jumpToFile = jumpToFile;
    perf.switchSession = switchSession;
    perf.files = files.length;
    afterPaint().then((painted) => {
      perf.firstRender = perf.responseAt === null ? null : painted - perf.responseAt;
      perf.ready = true;
    });
  }, [status, files.length, jumpToFile, openComposer, switchSession]);

  return (
    <div className={dragging ? "app dragging" : "app"}>
      <Header />
      <WarningsBar />
      <div className="workspace">
        <Sidebar />
        <CentrePanel />
        <ThreadRail />
      </div>
      <StatusBar />
      <Overlays />
      <Toast />
    </div>
  );
}

/** The two of handoff sections 5 and 9; global search is DA-26. */
function Overlays() {
  const baseOpen = useStore((store) => store.baseOpen);
  const exportOpen = useStore((store) => store.exportOpen);
  return (
    <>
      {baseOpen ? <BasePicker /> : null}
      {exportOpen ? <ExportModal /> : null}
    </>
  );
}

/**
 * The three keys the composer owns: `C` opens it on the first added line of the
 * file being read, `⌘⏎` sends it, `esc` closes it and every menu over it. The
 * rest of the map of the handoff is DA-26. A letter pressed inside a field is
 * text and not a command, but `⌘⏎` and `esc` are commands wherever they are
 * pressed — the field is exactly where the reviewer is when they send.
 */
function useKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const store = useStore.getState();
      if (event.key === "Escape") {
        store.closeComposer();
        store.setSessionMenu(false);
        store.openBase(false);
        store.openExport(false);
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && store.composer !== null) {
        event.preventDefault();
        void store.submitComment();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A letter under an overlay belongs to the overlay, not to the diff
      // behind it; `esc` above is what closes one.
      if (store.baseOpen || store.exportOpen || store.paletteOpen) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]")) {
        return;
      }
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        // A second `C` would reopen the form on the same line and throw away
        // what has been typed into it; `esc` is how it is closed.
        if (store.composer === null) store.commentOnCurrentFile();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
