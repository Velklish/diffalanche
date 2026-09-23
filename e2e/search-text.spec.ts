import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** Text search of DA-38: a word the working trees hold, found in every repository that has it,
 * previewed with its neighbours, and opened in browse mode at its line. */

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card table.diff").first().waitFor();
}

test("a word in two repositories lists matches from both, and ⏎ opens one at its line", async ({
  page,
}) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill("normalises");

  const rows = page.locator(".palette-hit:has(.palette-tag.text)");
  await expect(rows.first()).toBeVisible();
  const repos = new Set(await rows.evaluateAll((all) => all.map((row) => row.dataset.repo)));
  expect(repos.size).toBeGreaterThanOrEqual(2);

  const row = rows.nth(1);
  await row.hover();
  // The preview is the matched line between its neighbours, the match itself marked.
  await expect(page.locator(".palette-line.on")).toContainText(/normalises/i);
  expect(await page.locator(".palette-line").count()).toBeGreaterThan(1);

  const label = (await row.locator(".palette-name").textContent()) ?? "";
  const at = label.lastIndexOf(":");
  const path = label.slice(0, at);
  const line = label.slice(at + 1);
  await page.keyboard.press("Enter");

  await expect(page.locator(".plain-card .file-path")).toHaveText(path);
  const target = page.locator(`[data-plain-line="${line}"]`);
  await expect(target).toBeInViewport();
  await expect(target.locator(".plain-code")).toContainText(/normalises/i);
});

test("a double press on the next page appends it once", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill("normalises");
  const more = page.locator(".palette-more");
  await expect(more).toBeVisible();
  const label = (await more.textContent()) ?? "";
  const total = Number(/из (\d+)/.exec(label)?.[1] ?? "0");

  await more.dblclick();
  const rows = page.locator(".palette-hit:has(.palette-tag.text)");
  await expect(rows).toHaveCount(total);
  const names = await rows.locator(".palette-name").allTextContents();
  expect(new Set(names).size).toBe(names.length);
});

test("a next page that failed can be asked for again", async ({ page }) => {
  let refused = 0;
  await page.route("**/api/search/text?*page=1*", async (route) => {
    if (refused === 0) {
      refused += 1;
      await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return;
    }
    await route.continue();
  });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill("normalises");
  const more = page.locator(".palette-more");
  const total = Number(/из (\d+)/.exec((await more.textContent()) ?? "")?.[1] ?? "0");

  await more.click();
  await expect.poll(() => refused).toBe(1);
  await more.click();
  await expect(page.locator(".palette-hit:has(.palette-tag.text)")).toHaveCount(total);
});

test("the hit the keyboard is on keeps the focus when the text hits land after it", async ({
  page,
}) => {
  // The text answer is held until the keyboard is on a hit, so the results land after it.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/search/text?*", async (route) => {
    await held;
    await route.continue();
  });
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill("ts");
  const hit = page.locator(".palette-hit.on");
  await expect(hit).toHaveCount(1);
  for (
    let step = 0;
    step < 6 && !(await hit.evaluate((el) => el === document.activeElement));
    step++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(hit).toBeFocused();

  release();
  await expect(page.locator(".palette-hit:has(.palette-tag.text)").first()).toBeVisible();
  await expect(hit).toBeFocused();
});
