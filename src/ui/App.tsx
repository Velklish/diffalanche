import { useCallback, useEffect, useLayoutEffect } from "react";
import { firstAddedLine } from "./anchor.ts";
import { BasePicker } from "./components/BasePicker.tsx";
import { CentrePanel } from "./components/CentrePanel.tsx";
import { ExportModal } from "./components/ExportModal.tsx";
import { FirstRun } from "./components/FirstRun.tsx";
import { GlobalSearch } from "./components/GlobalSearch.tsx";
import { Header } from "./components/Header.tsx";
import { NewTaskForm, ScopeConfirmation, ScopeEditor } from "./components/ScopeEditor.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ThreadRail } from "./components/ThreadRail.tsx";
import { Toast } from "./components/Toast.tsx";
import { WarningsBar } from "./components/WarningsBar.tsx";
import { useKeys } from "./keys.ts";
import { startLive } from "./live.ts";
import { afterPaint, perf } from "./perf.ts";
import { revealFile } from "./reveal.ts";
import { useStore } from "./store.ts";

/** Frames a jump waits for the target's diff to mount before the hook calls it a failure. */
const MOUNT_FRAMES = 10;

export function App() {
  const theme = useStore((store) => store.theme);
  const sidebarOn = useStore((store) => store.sidebarOn);
  const railOn = useStore((store) => store.railOn);
  const wrap = useStore((store) => store.wrap);
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

  // The width the pre-mount estimate wraps against; the panels move it through
  // their own toggles, and the window moves it here.
  useEffect(() => {
    const measure = () => useStore.getState().measureCentre();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Switching a task pushes `?review=<name>`, so `Back` walks the tasks this window has shown
  // (08-ui.md, "The task this window is on").
  useEffect(() => {
    const follow = () => void useStore.getState().syncTaskFromUrl();
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  // Opened after the first read is asked for, and open for the life of the page: it is what keeps
  // the review current without a reload ([ADR-005](../../docs/adr/adr-005-live-update.md)).
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

  /** A session switch, from the press to the frame showing the other review: the whole wait, as
   * the spec's row has no "after the server responds" (11-perf.md, "Switching review sessions"). */
  const switchSession = useCallback(async (name: string) => {
    const start = performance.now();
    await useStore.getState().switchSession(name);
    if (useStore.getState().session?.name !== name) {
      throw new Error(`the session did not switch to ${name}`);
    }
    const painted = await afterPaint();
    return painted - start;
  }, []);

  /** What a row of the tree does, timed from the press to the frame that shows the file's diff
   * where the jump left it: the reader's wait, not the first scroll alone (DA-82, 11-perf.md). */
  const jumpToFile = useCallback(async (index: number) => {
    const entry = useStore.getState().files.find((one) => one.index === index);
    if (!entry) throw new Error(`no file ${index}`);
    // A card collapsed or with an omitted diff has no body to wait for.
    const unmounted = `[data-file="${CSS.escape(entry.id)}"] .file-body:not(.mounted)`;
    const start = performance.now();
    await revealFile(entry.repo, entry.file.path);
    let painted = await afterPaint();
    for (let frame = 1; document.querySelector(unmounted) !== null; frame += 1) {
      if (frame >= MOUNT_FRAMES) throw new Error(`the diff of ${entry.id} did not mount`);
      painted = await afterPaint();
    }
    const { repo, path } = useStore.getState();
    if (repo !== entry.repo || path !== entry.file.path) {
      throw new Error(`the jump to ${entry.id} left ${repo}/${path} current`);
    }
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

  // A hidden panel is a class rather than a style, because the floor `.app`
  // keeps is the one the panels still on the screen add up to (DA-107).
  const shape = ["app"];
  if (dragging) shape.push("dragging");
  if (!sidebarOn) shape.push("sidebar-off");
  if (!railOn) shape.push("rail-off");
  if (wrap) shape.push("wrap");

  return (
    <div className={shape.join(" ")}>
      <Header />
      <WarningsBar />
      {/* A root with no session has no review to lay out: the screen that
          offers to make one takes the whole body (handoff section 10). */}
      {status === "no-session" ? (
        <FirstRun />
      ) : (
        <div className="workspace">
          {sidebarOn ? <Sidebar /> : null}
          <CentrePanel />
          {railOn ? <ThreadRail /> : null}
        </div>
      )}
      <StatusBar />
      <Overlays />
      <Toast />
    </div>
  );
}

/** The overlays of handoff sections 5, 6, 9 and 12, one at a time: the scope's three are exclusive
 * here, so the confirmation replaces the editor (08-ui.md, "Overlay and toast"). */
function Overlays() {
  const baseOpen = useStore((store) => store.baseOpen);
  const exportOpen = useStore((store) => store.exportOpen);
  const scopeOpen = useStore((store) => store.scopeOpen);
  const confirm = useStore((store) => store.scopeConfirm);
  const newTaskOpen = useStore((store) => store.newTaskOpen);
  return (
    <>
      {baseOpen ? <BasePicker /> : null}
      {exportOpen ? <ExportModal /> : null}
      {confirm !== null ? (
        <ScopeConfirmation confirm={confirm} />
      ) : scopeOpen ? (
        <ScopeEditor />
      ) : newTaskOpen ? (
        <NewTaskForm />
      ) : null}
      <GlobalSearch />
    </>
  );
}

/** How often the relative times on screen are recounted: one timer for the page, in the store,
 * rather than one per row (08-ui.md, "Patching, not repainting"). */
const TICK_MS = 5_000;

function useClock(): void {
  useEffect(() => {
    const timer = setInterval(() => useStore.getState().bumpTick(), TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
