import { useCallback, useEffect, useLayoutEffect } from "react";
import { CentrePanel } from "./components/CentrePanel.tsx";
import { Header } from "./components/Header.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ThreadRail } from "./components/ThreadRail.tsx";
import { Toast } from "./components/Toast.tsx";
import { afterPaint, perf } from "./perf.ts";
import { useStore } from "./store.ts";

export function App() {
  const theme = useStore((store) => store.theme);
  const status = useStore((store) => store.status);
  const files = useStore((store) => store.files);
  const loadReview = useStore((store) => store.loadReview);
  const openComposerAt = useStore((store) => store.openComposer);

  // Before paint, so a light-theme reload never flashes the dark palette.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  const openComposer = useCallback(async () => {
    const entry = files[0];
    if (!entry) throw new Error("the review has no files");
    const start = performance.now();
    openComposerAt({
      repo: entry.repo,
      path: entry.file.path,
      side: "new",
      line: firstNewLine(entry.file.patch),
    });
    const painted = await afterPaint();
    return painted - start;
  }, [files, openComposerAt]);

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
    perf.files = files.length;
    afterPaint().then((painted) => {
      perf.firstRender = perf.responseAt === null ? null : painted - perf.responseAt;
      perf.ready = true;
    });
  }, [status, files.length, jumpToFile, openComposer]);

  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <Sidebar />
        <CentrePanel />
        <ThreadRail />
      </div>
      <StatusBar />
      <Toast />
    </div>
  );
}

/** The first line of the new side: where `C` and the perf harness open the form. */
function firstNewLine(patch: string): number {
  const header = patch.split("\n").find((line) => line.startsWith("@@")) ?? "";
  const match = /\+(\d+)/.exec(header);
  return match?.[1] ? Number(match[1]) : 1;
}
