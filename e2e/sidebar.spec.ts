import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

type Review = {
  repositories: { path: string; files: { path: string }[] }[];
  comments: { repo: string | null; path: string | null; status: string }[];
};

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".repo-row").first().waitFor();
}

function review(page: Page): Promise<Review> {
  return page.evaluate(async () => (await (await fetch("/api/review")).json()) as Review);
}

test("the tree lists the repositories with changes, and only those", async ({ page }) => {
  await open(page);
  const bundle = await review(page);

  const rows = await page.locator(".repo-row .repo-name").allTextContents();
  expect(rows).toEqual(bundle.repositories.map((repo) => repo.path));

  // The synthetic review holds a clean sibling worktree; it has no changes.
  expect(rows.some((row) => row.includes("worktree"))).toBe(false);
});

test("a file badge is the number of open comments on that file", async ({ page }) => {
  await open(page);
  const bundle = await review(page);

  const expected = new Map<string, number>();
  for (const comment of bundle.comments) {
    if (comment.status === "resolved" || !comment.repo || !comment.path) continue;
    const key = `${comment.repo}/${comment.path}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  expect(expected.size).toBeGreaterThan(0);

  const shown = await page.evaluate(() => {
    const badges: Record<string, string> = {};
    const rows = document.querySelectorAll(".branch");
    for (const branch of rows) {
      const repo = branch.querySelector(".repo-name")?.textContent ?? "";
      for (const row of branch.querySelectorAll(".file-row")) {
        const badge = row.querySelector(".badge")?.textContent;
        if (badge) badges[`${repo}/${row.querySelector(".file-name")?.textContent}`] = badge;
      }
    }
    return badges;
  });

  expect(Object.keys(shown).length).toBe(expected.size);
  for (const [key, count] of expected) expect(shown[key]).toBe(String(count));
});

test("the filter narrows the tree and its count", async ({ page }) => {
  await open(page);
  const bundle = await review(page);
  const all = bundle.repositories.reduce((sum, repo) => sum + repo.files.length, 0);
  await expect(page.locator(".matches")).toHaveText(String(all));

  await page.getByLabel("filter").fill(".md");
  const shown = await page.locator(".file-row").count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(all);
  await expect(page.locator(".matches")).toHaveText(String(shown));

  await page.getByLabel("filter").fill("nothing-matches-this");
  await expect(page.locator(".tree-empty")).toBeVisible();
  await expect(page.locator(".matches")).toHaveText("0");
});

test("choosing a file brings its card into view inside the budget", async ({ page }) => {
  await open(page);

  const jump = await page.evaluate(async () => {
    const rows = document.querySelectorAll<HTMLElement>(".file-row");
    const row = rows[rows.length - 1];
    if (!row) throw new Error("no file rows");
    const start = performance.now();
    row.click();
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return performance.now() - start;
  });

  expect(jump).toBeLessThan(50);

  const selected = page.locator(".file-row.on");
  await expect(selected).toHaveCount(1);
  const path = await selected.locator(".file-name").textContent();
  const top = await page
    .locator(`.file-card[data-path="${path}"]`)
    .first()
    .evaluate((card) => card.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(200);
});

test("the current file follows the reading position", async ({ page }) => {
  await open(page);
  const first = await page.locator(".file-row.on .file-name").textContent();

  await page.evaluate(() => window.__perf.jumpToFile(6));
  await expect(page.locator(".file-row.on .file-name")).not.toHaveText(first ?? "", {
    timeout: 2000,
  });

  const now = await page.locator(".file-row.on .file-name").textContent();
  const card = await page
    .locator(`.file-card[data-path="${now}"]`)
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(card).toBeLessThan(300);
});

test("a repository collapses and expands", async ({ page }) => {
  await open(page);
  const branch = page.locator(".branch").first();
  const files = await branch.locator(".file-row").count();
  expect(files).toBeGreaterThan(0);

  await branch.locator(".repo-row").click();
  await expect(branch.locator(".file-row")).toHaveCount(0);
  await expect(branch.locator(".repo-row")).toHaveAttribute("aria-expanded", "false");

  await branch.locator(".repo-row").click();
  await expect(branch.locator(".file-row")).toHaveCount(files);
});

test("the keyboard walks the filter, the repository, then its files", async ({ page }) => {
  await open(page);
  await page.getByLabel("filter").focus();

  await page.keyboard.press("Tab");
  await expect(page.locator(".repo-row").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".file-row").first()).toBeFocused();
});
