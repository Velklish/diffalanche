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
  warnings: [],
};

/** The panel widths of the handoff, and the threshold below which the page scrolls. */
const SIDEBAR = 308;
const RAIL = 392;
const THRESHOLD = 1560;

async function open(page: Page) {
  await page.route("**/api/review", (route) => route.fulfill({ json: EMPTY_REVIEW }));
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.evaluate(() => document.fonts.ready);
}

test("the empty shell in the dark theme", async ({ page }) => {
  await open(page);
  await expect(page).toHaveScreenshot("shell-dark.png", { fullPage: true });
});

test("the empty shell in the light theme", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "light theme" }).click();
  await expect(page.locator(":root")).toHaveAttribute("data-theme", "light");
  await expect(page).toHaveScreenshot("shell-light.png", { fullPage: true });
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
