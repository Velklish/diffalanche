import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** The shell on its own: the server's review is stubbed away. */
const EMPTY_REVIEW = {
  root: "/empty",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
  session: {
    version: 1,
    name: "ui-shell",
    title: "The empty shell of the review workspace",
    base: { mode: "head" },
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
  },
  comments: [],
  counters: {
    counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
    repositories: [],
  },
  warnings: [],
};

/** The panel widths of the handoff, and the threshold below which the page scrolls. */
const SIDEBAR = 308;
const RAIL = 392;
const THRESHOLD = 1560;

async function open(page: Page) {
  await page.route("**/api/review", (route) => route.fulfill({ json: EMPTY_REVIEW }));
  // The feed is the server's own and carries whatever the other specs wrote a
  // moment ago, so `N live` in the activity panel would vary from run to run
  // and the baselines with it (DA-25).
  await page.route("**/api/activity", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.evaluate(() => document.fonts.ready);
}

/** The footer prints the server's port, and the suite stopped running on a
 * fixed one (DA-54.2): masked for the reason `/api/activity` is stubbed. */
const varies = (page: Page) => [page.locator(".sidebar-foot")];

/** The baselines are the pixels macOS draws, and no other platform has any: elsewhere the two
 * comparisons are skipped and say so, rather than passing with nothing compared (08-ui.md). */
const BASELINES = "the shell baselines were taken on macOS, and this platform draws other pixels";

test("the empty shell in the dark theme", async ({ page }) => {
  test.skip(process.platform !== "darwin", BASELINES);
  await open(page);
  await expect(page).toHaveScreenshot("shell-dark.png", {
    fullPage: true,
    mask: varies(page),
  });
});

test("the empty shell in the light theme", async ({ page }) => {
  test.skip(process.platform !== "darwin", BASELINES);
  await open(page);
  await page.getByRole("button", { name: "light theme" }).click();
  await expect(page.locator(":root")).toHaveAttribute("data-theme", "light");
  await expect(page).toHaveScreenshot("shell-light.png", {
    fullPage: true,
    mask: varies(page),
  });
});

test("nothing on the page animates without end", async ({ page }) => {
  await open(page);
  // The live dot pulsed for as long as the stream was up, until the owner took it out (DA-115):
  // at the perf gate's frame rate an endless animation composites on about three cores.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  const endless = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((one) => one.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY)
      .map((one) => (one as CSSAnimation).animationName ?? "an animation without a name"),
  );
  expect(endless).toEqual([]);
});

test("a reader who asked for less motion gets arrivals without their travel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  // What reduced motion takes from `dcin` is the travel, not the fade (DA-22.1).
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--dcin-shift").trim(),
    ),
  ).toBe("0px");
});

test("the theme survives a reload", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "light theme" }).click();
  await page.reload();
  await page.waitForFunction(() => window.__perf?.ready === true);
  await expect(page.locator(":root")).toHaveAttribute("data-theme", "light");
});

test("the panels keep their widths, and the page scrolls below the threshold", async ({ page }) => {
  await page.setViewportSize({ width: THRESHOLD, height: 900 });
  await open(page);

  expect((await page.locator("nav.sidebar").boundingBox())?.width).toBe(SIDEBAR);
  expect((await page.locator("aside.rail").boundingBox())?.width).toBe(RAIL);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(THRESHOLD);

  await page.setViewportSize({ width: 1400, height: 900 });
  expect((await page.locator("nav.sidebar").boundingBox())?.width).toBe(SIDEBAR);
  expect((await page.locator("aside.rail").boundingBox())?.width).toBe(RAIL);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

/** How wide the reading column is right now. */
function centre(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector(".centre")?.getBoundingClientRect().width ?? 0);
}

test("[ takes the sidebar off the screen and gives its width to the reading column", async ({
  page,
}) => {
  await page.setViewportSize({ width: THRESHOLD, height: 900 });
  await open(page);
  const before = await centre(page);

  await page.keyboard.press("[");
  await expect(page.locator("nav.sidebar")).toHaveCount(0);
  expect(await centre(page)).toBe(before + SIDEBAR);

  await page.keyboard.press("[");
  await expect(page.locator("nav.sidebar")).toHaveCount(1);
  expect(await centre(page)).toBe(before);
});

test("] does the same for the thread rail", async ({ page }) => {
  await page.setViewportSize({ width: THRESHOLD, height: 900 });
  await open(page);
  const before = await centre(page);

  await page.keyboard.press("]");
  await expect(page.locator("aside.rail")).toHaveCount(0);
  expect(await centre(page)).toBe(before + RAIL);
});

test("a panel put away stays away across a reload, and the header brings it back", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("[");
  await page.keyboard.press("]");
  await page.reload();
  await page.waitForFunction(() => window.__perf?.ready === true);

  await expect(page.locator("nav.sidebar")).toHaveCount(0);
  await expect(page.locator("aside.rail")).toHaveCount(0);

  await page.getByRole("button", { name: "show the navigation" }).click();
  await expect(page.locator("nav.sidebar")).toHaveCount(1);
  await page.getByRole("button", { name: "show the threads" }).click();
  await expect(page.locator("aside.rail")).toHaveCount(1);
});

test("with both panels away a 1200 px window stops scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await open(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(true);

  await page.keyboard.press("[");
  await page.keyboard.press("]");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
});

test("the panel keys are silent while a comment is being written", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: "filter" }).fill("");
  await page.getByRole("searchbox", { name: "filter" }).press("[");

  await expect(page.locator("nav.sidebar")).toHaveCount(1);
  await expect(page.getByRole("searchbox", { name: "filter" })).toHaveValue("[");
});

test("the fonts are local: nothing is requested outside 127.0.0.1", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:")) foreign.push(request.url());
  });
  await open(page);

  const families = await page.evaluate(() =>
    [...document.fonts].map((face) => `${face.family} ${face.status}`),
  );
  expect(families).toContain("Instrument Sans loaded");
  expect(families).toContain("JetBrains Mono loaded");
  expect(foreign).toEqual([]);
});
