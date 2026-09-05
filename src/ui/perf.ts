/**
 * The measurement hooks the performance harness drives from the page side.
 * They live in the UI, not in the harness, because only the UI knows when a
 * frame it caused has actually been painted.
 */

export type LongTask = { start: number; duration: number };

export type ScrollResult = {
  frames: number;
  startTime: number;
  endTime: number;
  distance: number;
  longTasks: LongTask[];
};

export type PerfApi = {
  ready: boolean;
  files: number;
  /** `performance.now()` when the review response was parsed. */
  responseAt: number | null;
  /** Milliseconds from that moment to the frame that showed the review. */
  firstRender: number | null;
  longTasks: LongTask[];
  scrollRun: (step: number, maxFrames: number) => Promise<ScrollResult>;
  openComposer: () => Promise<number>;
  jumpToFile: (index: number) => Promise<number>;
  /** Makes a session current and reports the milliseconds to the frame that showed it. */
  switchSession: (name: string) => Promise<number>;
  /**
   * The repository whose new diff the page last painted, and the wall clock of
   * the frame that showed it. `Date.now` and not `performance.now`, because the
   * harness edits the file from another process and the two ends of the 300 ms
   * budget have to be on one clock ([11-perf.md](../../docs/reference/11-perf.md)).
   */
  liveUpdate: { repo: string; at: number } | null;
};

const notReady = () => Promise.reject(new Error("the review has not rendered yet"));

export const perf: PerfApi = {
  ready: false,
  files: 0,
  responseAt: null,
  firstRender: null,
  longTasks: [],
  scrollRun,
  openComposer: notReady,
  jumpToFile: notReady,
  switchSession: notReady,
  liveUpdate: null,
};

/** Resolves after the browser has painted the frame the caller's work produced. */
export function afterPaint(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => resolve(performance.now()), 0);
    });
  });
}

/** Scrolls the whole review one step per frame and reports frames and long tasks. */
async function scrollRun(step: number, maxFrames: number): Promise<ScrollResult> {
  const element = document.scrollingElement as HTMLElement;
  element.scrollTop = 0;
  await afterPaint();

  const startTime = performance.now();
  const before = perf.longTasks.length;
  let frames = 0;
  await new Promise<void>((resolve) => {
    const tick = () => {
      frames += 1;
      const atEnd = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
      if (atEnd || frames >= maxFrames) {
        resolve();
        return;
      }
      element.scrollTop += step;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const endTime = performance.now();

  return {
    frames,
    startTime,
    endTime,
    distance: element.scrollTop,
    longTasks: perf.longTasks.slice(before),
  };
}

export function observeLongTasks(): void {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }
  });
  observer.observe({ type: "longtask", buffered: true });
}

declare global {
  interface Window {
    __perf: PerfApi;
  }
}
