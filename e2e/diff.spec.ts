import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  // The cards mount their diff from an IntersectionObserver, after the first paint.
  await page.locator(".file-card table.diff").first().waitFor();
}

/** The new-side line numbers a card shows, in the order it shows them. */
function newLineNumbers(page: Page, card: number): Promise<string[]> {
  return page.evaluate((index) => {
    const table = document.querySelectorAll(".file-card")[index]?.querySelector("table.diff");
    if (!table) return [];
    const split = table.classList.contains("dc-split");
    const numbers: string[] = [];
    for (const row of table.querySelectorAll("tr.diff-line")) {
      const cell = [...row.children][split ? 2 : 1];
      const text = cell?.textContent?.trim() ?? "";
      if (text) numbers.push(text);
    }
    return numbers;
  }, card);
}

/** Walks the review to the first file with at least three hunks and mounts it. */
async function threeHunkCard(page: Page): Promise<number> {
  const total = await page.evaluate(() => window.__perf.files);
  for (let index = 0; index < total; index += 1) {
    await page.evaluate((i: number) => window.__perf.jumpToFile(i), index);
    const hunks = await page.evaluate(
      (i: number) =>
        document.querySelectorAll(".file-card")[i]?.querySelectorAll("tbody.hunk-head").length ?? 0,
      index,
    );
    if (hunks >= 3) return index;
  }
  return -1;
}

test("split and unified show the same line numbers", async ({ page }) => {
  await open(page);
  const card = await threeHunkCard(page);
  expect(card).toBeGreaterThanOrEqual(0);

  const split = await newLineNumbers(page, card);
  expect(split.length).toBeGreaterThan(10);

  await page.locator(".file-card").nth(card).getByRole("button", { name: "unified" }).click();
  await expect(page.locator(".file-card").nth(card).locator("table.diff")).toHaveClass(
    /dc-unified/,
  );
  expect(await newLineNumbers(page, card)).toEqual(split);
});

test("a file has one horizontal scrollbar and two columns of the same width", async ({ page }) => {
  await open(page);
  const geometry = await page.evaluate(() => {
    const card = document.querySelector(".file-card") as HTMLElement;
    const scrollers = [...card.querySelectorAll("*")].filter((element) => {
      const overflow = getComputedStyle(element).overflowX;
      return (
        (overflow === "auto" || overflow === "scroll") && element.scrollWidth > element.clientWidth
      );
    });
    const cells = [...(card.querySelector("tr.diff-line")?.children ?? [])];
    return {
      scrollers: scrollers.length,
      left: cells[1]?.getBoundingClientRect().width ?? 0,
      right: cells[3]?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(geometry.scrollers).toBe(1);
  expect(geometry.left).toBeGreaterThan(0);
  // A border between the columns makes the two differ by a fraction of a pixel.
  expect(geometry.right).toBeCloseTo(geometry.left, 0);
});

test("the height of an unseen card is close enough that the page does not jump", async ({
  page,
}) => {
  await open(page);
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.evaluate(async () => {
    const element = document.scrollingElement as HTMLElement;
    const step = Math.ceil((element.scrollHeight - element.clientHeight) / 200);
    await window.__perf.scrollRun(step, 200);
  });
  const after = await page.evaluate(() => document.documentElement.scrollHeight);

  // Every card has been measured by now; the estimate it replaced was this close.
  expect(Math.abs(after - before) / before).toBeLessThan(0.02);
});

test("the view of a file survives leaving and coming back", async ({ page }) => {
  await open(page);
  await page.locator(".file-card").first().getByRole("button", { name: "unified" }).click();

  await page.evaluate(async () => {
    const element = document.scrollingElement as HTMLElement;
    await window.__perf.scrollRun(Math.ceil(element.scrollHeight / 60), 60);
  });
  await page.evaluate(() => window.__perf.jumpToFile(0));

  await expect(page.locator(".file-card").first().locator("table.diff")).toHaveClass(/dc-unified/);
});

test("the context of a hunk collapses and comes back", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  const rows = () => card.locator("tr.diff-line").count();

  const all = await rows();
  await card.locator("button.hunk-context").first().click();
  const collapsed = await rows();
  expect(collapsed).toBeLessThan(all);

  await expect(card.locator("button.hunk-context").first()).toHaveText(/↑ \d+ lines/);
  await card.locator("button.hunk-context").first().click();
  expect(await rows()).toBe(all);
});

test("a file card collapses to its header", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  await expect(card.locator("table.diff")).toBeVisible();
  await card.getByRole("button", { name: "collapse", exact: true }).click();
  await expect(card.locator("table.diff")).toHaveCount(0);
});
