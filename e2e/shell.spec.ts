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

test("nothing pulses for a reader who asked for less motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  // The footer's dot is the element that pulses, and it is a plain dot until
  // the stream has answered: without this the test would pass on a page that
  // has nothing to animate.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");

  const moving = await page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((one) => getComputedStyle(one).animationName)
      .filter((name) => name !== "none" && name !== ""),
  );
  // `dcpulse` runs for as long as the review is open, so it is the one that
  // matters; `dcin` is an entrance that has already finished by now, and what
  // reduced motion takes from it is the travel, not the fade (DA-22.1).
  expect(moving).not.toContain("dcpulse");
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
