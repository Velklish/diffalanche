/**
 * The performance harness of `docs/SPEC.md` section 6: it drives headless
 * Chromium over the synthetic review and reports the numbers of the budget
 * table.
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { loadConfig } from "../src/core/config/index.ts";
import { directoryAssets, startReviewServer } from "../src/server/index.ts";

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
  /** From the edit of one file to the page holding that repository's new diff. */
  updateMs: number;
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

/** The line the update probe appends and then takes back out. */
const PROBE_LINE = "\n// diffalanche measured the update after an edit here\n";

export async function measure(
  baseUrl: string,
  variant: VariantSpec,
  fixture: string,
): Promise<Measurement> {
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

    const updateMs = await measureUpdate(page, baseUrl, fixture);
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
      updateMs: round(updateMs),
    };
  } finally {
    await browser.close();
  }
}

/**
 * The budget of `docs/SPEC.md` section 6 for a change in one repository: a file
 * is edited here, and the page — listening on `/api/events` the way the UI does
 * — says when it has that repository's new diff in hand. That is the watcher,
 * the rescan, the stream, and the fetch; the render of the patched diff is what
 * DA-25 adds to the same number.
 *
 * The edit is taken back out afterwards, so the fixture is what it was.
 */
async function measureUpdate(page: Page, baseUrl: string, fixture: string): Promise<number> {
  const scan = (await (await fetch(`${baseUrl}/api/scan`)).json()) as {
    repositories: { path: string; hasChanges: boolean }[];
  };
  const repo = scan.repositories.find((one) => one.hasChanges)?.path;
  if (repo === undefined) throw new Error(`${fixture}: no repository with changes to edit`);
  const diff = (await (await fetch(`${baseUrl}/api/repos/${repo}/diff`)).json()) as {
    files: { path: string; status: string; omitted: string | null }[];
  };
  const file = diff.files.find((one) => one.omitted === null && one.status !== "deleted")?.path;
  if (file === undefined) throw new Error(`${repo}: no file with content to edit`);

  await page.evaluate((watched: string) => {
    const held = window as unknown as { __update?: number | null };
    held.__update = null;
    const source = new EventSource("/api/events");
    source.addEventListener("diff-changed", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { repo: string };
      if (data.repo !== watched) return;
      void fetch(`/api/repos/${watched}/diff`)
        .then((response) => response.json())
        .then(() => {
          held.__update = Date.now();
          source.close();
        });
    });
  }, repo);

  const target = join(fixture, repo, file);
  const original = await readFile(target, "utf8");
  const started = Date.now();
  try {
    await appendFile(target, PROBE_LINE);
    await page.waitForFunction(
      () => (window as unknown as { __update?: number | null }).__update !== null,
      undefined,
      { timeout: 60_000 },
    );
    return (
      ((await page.evaluate(
        () => (window as unknown as { __update: number }).__update,
      )) as number) - started
    );
  } finally {
    // Whatever happened, the fixture is what it was: a run that ended in the
    // middle would otherwise leave the line behind for every run after it.
    await writeFile(target, original);
    // The rescan of the restored file lands before the next run starts.
    await new Promise((done) => setTimeout(done, 500));
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
  // Port 0 is not a port a configuration may name, so it is set here rather
  // than through `loadConfig`: the harness takes whatever is free.
  const config = { ...(await loadConfig({ root: fixture })), port: 0 };
  const server = await startReviewServer({ config, ui: directoryAssets("dist/ui") });
  try {
    const { totals } = await server.review.document();
    process.stderr.write(
      `fixture ${fixture}: ${totals.repositories} repositories, ` +
        `${totals.files} files, ${totals.lines} lines\n`,
    );
    return await body(server.url);
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
