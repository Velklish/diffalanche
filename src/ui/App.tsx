import { useCallback, useEffect, useLayoutEffect } from "react";
import { firstAddedLine } from "./anchor.ts";
import { BasePicker } from "./components/BasePicker.tsx";
import { CentrePanel } from "./components/CentrePanel.tsx";
import { ExportModal } from "./components/ExportModal.tsx";
import { FirstRun } from "./components/FirstRun.tsx";
import { GlobalSearch } from "./components/GlobalSearch.tsx";
import { Header } from "./components/Header.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ThreadRail } from "./components/ThreadRail.tsx";
import { Toast } from "./components/Toast.tsx";
import { WarningsBar } from "./components/WarningsBar.tsx";
import { useKeys } from "./keys.ts";
import { startLive } from "./live.ts";
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

  // The stream is opened after the first read is asked for and stays open for
  // the life of the page: what it carries is what keeps the review current
  // without a reload ([ADR-005](../../docs/adr/adr-005-live-update.md)).
  useEffect(() => startLive(), []);

  useClock();

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
   * The swap of a review session: from the press to the frame that shows the
   * other review — the `POST` that makes it current, the read of the review
   * that follows, and the render. `docs/SPEC.md` section 6 qualifies only the
   * first-render row with "after the server responds"; this row has no such
   * qualifier, so the window is the whole wait, and a session whose change set
   * has to be computed is part of what the reader waits for.
   */
  const switchSession = useCallback(async (name: string) => {
    const start = performance.now();
    await useStore.getState().switchSession(name);
    if (useStore.getState().session?.name !== name) {
      throw new Error(`the session did not switch to ${name}`);
    }
    const painted = await afterPaint();
    return painted - start;
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
      {/* A root with no session has no review to lay out: the screen that
          offers to make one takes the whole body (handoff section 10). */}
      {status === "no-session" ? (
        <FirstRun />
      ) : (
        <div className="workspace">
          <Sidebar />
          <CentrePanel />
          <ThreadRail />
        </div>
      )}
      <StatusBar />
      <Overlays />
      <Toast />
    </div>
  );
}

/** The three of handoff sections 5, 6 and 9, each opening over the same scrim. */
function Overlays() {
  const baseOpen = useStore((store) => store.baseOpen);
  const exportOpen = useStore((store) => store.exportOpen);
  return (
    <>
      {baseOpen ? <BasePicker /> : null}
      {exportOpen ? <ExportModal /> : null}
      <GlobalSearch />
    </>
  );
}

/**
 * How often the relative times on screen are recounted, as the handoff's
 * activity panel requires. One timer for the page, in the store, rather than
 * one per row.
 */
const TICK_MS = 5_000;

function useClock(): void {
  useEffect(() => {
    const timer = setInterval(() => useStore.getState().bumpTick(), TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
