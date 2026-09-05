/**
 * The performance harness of `docs/SPEC.md` section 6: it drives headless
 * Chromium over the synthetic review and reports the numbers of the budget
 * table.
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import {
  addComment,
  createSession,
  // Not by its own name: a `use…` call is read as a React hook by the linter,
  // and this file is checked by the same rules as the page.
  useSession as makeCurrent,
  resolveSessionName,
} from "../src/core/domain/index.ts";
import {
  readDiffCache,
  sessionDir,
  sessionExists,
  withLock,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import { directoryAssets, startReviewServer } from "../src/server/index.ts";

export type VariantSpec = { name: string; query: string };

/**
 * The page as it ships. The Phase 0 spike carried both diff libraries and
 * measured eight combinations of library, highlighting, and virtualisation from
 * one build; ADR-008 chose one and DA-21 removed the switches, so there is one
 * page left to measure.
 */
export const VARIANTS: VariantSpec[] = [{ name: "default", query: "" }];

/** The two sessions a run switches between; the second one the harness makes. */
export type Sessions = { current: string; other: string };

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
  /** From the press to the frame that showed the other review: the whole wait. */
  sessionSwitchMs: number;
  loadLongTaskMs: number;
  /** From the edit of one file to the frame that showed it in that file's card. */
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
const PROBE_MARK = "diffalanche measured the update after an edit here";
const PROBE_LINE = `\n// ${PROBE_MARK}\n`;

export async function measure(
  baseUrl: string,
  variant: VariantSpec,
  fixture: string,
  sessions: Sessions,
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

    // Both ways, and the slower of them counts: the run has to leave the
    // fixture on the session it found it on, so the switch back happens either
    // way and there is no reason to measure only one of the two.
    const there = (await page.evaluate(
      (name: string) => window.__perf.switchSession(name),
      sessions.other,
    )) as number;
    const back = (await page.evaluate(
      (name: string) => window.__perf.switchSession(name),
      sessions.current,
    )) as number;

    // Last, and on the session the fixture came in on: the edit is measured
    // against the change set the page is actually showing.
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
      sessionSwitchMs: round(Math.max(there, back)),
      loadLongTaskMs: round(loaded.longTasks.reduce((sum, task) => sum + task.duration, 0)),
      updateMs: round(updateMs),
    };
  } finally {
    await browser.close();
  }
}

/**
 * The budget of `docs/SPEC.md` section 6 for a change in one repository: a file
 * of the fixture is edited here, and the page — the shipped one, listening on
 * `/api/events` because that is what it does — says when the card of that file
 * has the new diff in it. That is the watcher, the rescan, the stream, the
 * fetch, the patch, and the paint: the whole of what the person waits for.
 *
 * The card is scrolled to first, so it is mounted and the measurement is of a
 * diff that is on the screen rather than of one held in the store; the probe
 * line is looked for in the card afterwards, so a number that came from an
 * event about something else cannot pass for this one.
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
  const card = `${repo}/${file}`;

  await page.evaluate((id: string) => {
    document.querySelector(`[data-file="${CSS.escape(id)}"]`)?.scrollIntoView();
    window.__perf.liveUpdate = null;
  }, card);
  await page.waitForFunction(
    (id: string) =>
      document.querySelector(`[data-file="${CSS.escape(id)}"] .file-body.mounted`) !== null,
    card,
    { timeout: 60_000 },
  );

  const target = join(fixture, repo, file);
  const original = await readFile(target, "utf8");
  const started = Date.now();
  try {
    await appendFile(target, PROBE_LINE);
    await page.waitForFunction(
      (watched: string) => window.__perf.liveUpdate?.repo === watched,
      repo,
      { timeout: 60_000 },
    );
    const painted = (await page.evaluate(() => window.__perf.liveUpdate?.at ?? 0)) as number;
    const shown = (await page.evaluate(
      ({ id, mark }: { id: string; mark: string }) =>
        document.querySelector(`[data-file="${CSS.escape(id)}"]`)?.textContent?.includes(mark) ===
        true,
      { id: card, mark: PROBE_MARK },
    )) as boolean;
    if (!shown) throw new Error(`${card}: the edit was measured but the card does not show it`);
    return painted - started;
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
  body: (baseUrl: string, sessions: Sessions) => Promise<T>,
): Promise<T> {
  // Port 0 is not a port a configuration may name, so it is set here rather
  // than through `loadConfig`: the harness takes whatever is free.
  const config = { ...(await loadConfig({ root: fixture })), port: 0 };
  const sessions = await twoSessions(config);
  const server = await startReviewServer({ config, ui: directoryAssets("dist/ui") });
  try {
    const { totals } = await server.review.document();
    process.stderr.write(
      `fixture ${fixture}: ${totals.repositories} repositories, ` +
        `${totals.files} files, ${totals.lines} lines, ` +
        `sessions ${sessions.current} and ${sessions.other}\n`,
    );
    return await body(server.url, sessions);
  } finally {
    // A run that threw between the two switches would leave the fixture on the
    // other session, and the next run would measure that one.
    await makeCurrent(config.dataDir, sessions.current);
    await server.close();
  }
}

/** How many comments the second session is given, spread over the change set. */
const OTHER_COMMENTS = 40;

/**
 * The fixture carries one review session; switching between sessions needs two.
 * The second is made here rather than by the generator, because it is the
 * harness that measures the switch and nothing else needs it.
 *
 * It is given the first one's change set — the base is the same, so the answer
 * is the same — and comments of its own, so the swap really is a different set
 * of threads and not an empty rail.
 */
async function twoSessions(config: Config): Promise<Sessions> {
  const current = await resolveSessionName(config.dataDir);
  const other = `${current}-b`;
  if (await sessionExists(config.dataDir, other)) return { current, other };

  try {
    await createSession(config.dataDir, other, { mode: "head" }, "The other session");
    const cache = await readDiffCache(config.dataDir, current);
    if (cache !== null) {
      await withLock(sessionDir(config.dataDir, other), async (held) => {
        await held.assertHeld();
        await writeDiffCache(config.dataDir, other, cache);
      });
      const files = cache.repositories.flatMap((repo) =>
        repo.files.map((file) => ({ repo: repo.path, path: file.path })),
      );
      for (let i = 0; i < Math.min(OTHER_COMMENTS, files.length); i += 1) {
        const at = files[i];
        if (at === undefined) continue;
        await addComment(config.dataDir, other, {
          repo: at.repo,
          path: at.path,
          severity: "nit",
          body: `the other session says something about ${at.path}`,
          author: "kim.p",
          role: "human",
        });
      }
    }
  } finally {
    // `createSession` made it current. Whatever happened after that, the
    // fixture is left on the session it was found on: the next run reads
    // `current` and would otherwise measure the wrong review — or, worse,
    // measure it and say nothing.
    await makeCurrent(config.dataDir, current);
  }
  return { current, other };
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
