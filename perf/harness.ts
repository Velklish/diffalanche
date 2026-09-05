/**
 * The performance harness of `docs/SPEC.md` section 6: it drives headless
 * Chromium over the synthetic review and reports the numbers of the budget
 * table.
 */
import { chromium } from "@playwright/test";
import { buildReviewBundle, createApp, directoryAssets, startServer } from "../src/server/index.ts";

export type VariantSpec = { name: string; query: string };

/**
 * The page as it ships. The Phase 0 spike carried both diff libraries and
 * measured eight combinations of library, highlighting, and virtualisation from
 * one build; ADR-008 chose one and DA-21 removed the switches, so there is one
 * page left to measure.
 */
export const VARIANTS: VariantSpec[] = [{ name: "default", query: "" }];

export type Measurement = {
  variant: string;
  firstRenderMs: number;
  scrollLongTasks: number;
  scrollLongTaskMs: number;
  cpuPerFrameMs: number;
  frames: number;
  scrollDistancePx: number;
  composerOpenMs: number;
  fileJumpMs: number;
  loadLongTaskMs: number;
};

/** How many frames one pass over the whole review is given. */
const SCROLL_FRAMES = 600;

type PageMetrics = { firstRender: number | null; files: number; longTasks: LongTaskEntry[] };
type LongTaskEntry = { start: number; duration: number };
type ScrollOutcome = {
  frames: number;
  startTime: number;
  endTime: number;
  distance: number;
  longTasks: LongTaskEntry[];
};

export async function measure(baseUrl: string, variant: VariantSpec): Promise<Measurement> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");

    await page.goto(`${baseUrl}/?${variant.query}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__perf?.ready === true, undefined, {
      timeout: 120_000,
    });

    const loaded = (await page.evaluate(() => ({
      firstRender: window.__perf.firstRender,
      files: window.__perf.files,
      longTasks: window.__perf.longTasks,
    }))) as PageMetrics;

    const step = await page.evaluate((frames: number) => {
      const element = document.scrollingElement as HTMLElement;
      return Math.max(1, Math.ceil((element.scrollHeight - element.clientHeight) / frames));
    }, SCROLL_FRAMES);

    const before = await taskDuration(cdp);
    const scroll = (await page.evaluate(
      (options: { step: number; frames: number }) =>
        window.__perf.scrollRun(options.step, options.frames),
      { step, frames: SCROLL_FRAMES },
    )) as ScrollOutcome;
    const after = await taskDuration(cdp);

    const composerOpenMs = (await page.evaluate(() => window.__perf.openComposer())) as number;
    const jumps: number[] = [];
    for (const index of [loaded.files - 1, Math.floor(loaded.files / 2), 0]) {
      jumps.push(
        (await page.evaluate((i: number) => window.__perf.jumpToFile(i), index)) as number,
      );
    }

    await context.close();

    const scrollLongTaskMs = scroll.longTasks.reduce((sum, task) => sum + task.duration, 0);
    return {
      variant: variant.name,
      firstRenderMs: round(loaded.firstRender ?? Number.NaN),
      scrollLongTasks: scroll.longTasks.length,
      scrollLongTaskMs: round(scrollLongTaskMs),
      cpuPerFrameMs: round(((after - before) * 1000) / Math.max(1, scroll.frames)),
      frames: scroll.frames,
      scrollDistancePx: Math.round(scroll.distance),
      composerOpenMs: round(composerOpenMs),
      fileJumpMs: round(median(jumps)),
      loadLongTaskMs: round(loaded.longTasks.reduce((sum, task) => sum + task.duration, 0)),
    };
  } finally {
    await browser.close();
  }
}

/** Chromium's own accounting of time spent on tasks in the renderer, in seconds. */
async function taskDuration(cdp: { send: (method: "Performance.getMetrics") => Promise<unknown> }) {
  const result = (await cdp.send("Performance.getMetrics")) as {
    metrics: { name: string; value: number }[];
  };
  return result.metrics.find((metric) => metric.name === "TaskDuration")?.value ?? 0;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function withServer<T>(
  fixture: string,
  body: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const bundle = await buildReviewBundle(fixture);
  process.stderr.write(
    `fixture ${fixture}: ${bundle.totals.repositories} repositories, ` +
      `${bundle.totals.files} files, ${bundle.totals.lines} lines\n`,
  );
  const app = createApp({ bundle, ui: directoryAssets("dist/ui") });
  const server = await startServer(app, 0);
  try {
    return await body(`http://127.0.0.1:${server.port}`);
  } finally {
    await server.close();
  }
}

export type Options = { fixture: string; variants: string[]; runs: number };

export function parseArgs(argv: string[], defaultRuns = 1): Options {
  const options: Options = { fixture: ".perf/fixture", variants: [], runs: defaultRuns };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--fixture" && value) options.fixture = value;
    else if (flag === "--variant" && value) options.variants.push(value);
    else if (flag === "--runs") options.runs = parseRuns(value);
  }
  return options;
}

/** A run count that is not a whole number of at least one is a mistake, not a default. */
function parseRuns(value: string | undefined): number {
  const runs = Number(value);
  if (value === undefined || !Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs takes a whole number of at least 1, got: ${value ?? "nothing"}`);
  }
  return runs;
}
