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
  variant: string;
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
};

const notReady = () => Promise.reject(new Error("the review has not rendered yet"));

export const perf: PerfApi = {
  variant: "",
  ready: false,
  files: 0,
  responseAt: null,
  firstRender: null,
  longTasks: [],
  scrollRun,
  openComposer: notReady,
  jumpToFile: notReady,
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
