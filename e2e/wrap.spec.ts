import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** A long line is read without dragging it sideways (DA-107); the review is
 * stubbed because the generator makes no line of a known length this long. */
const LONG = "x".repeat(300);
const PATCH = [
  "diff --git a/src/long.ts b/src/long.ts",
  "index 1111111..2222222 100644",
  "--- a/src/long.ts",
  "+++ b/src/long.ts",
  "@@ -1,2 +1,3 @@",
  " const before = 1;",
  `+const long = "${LONG}";`,
  " const after = 2;",
  "",
].join("\n");

/** Ten words of thirty characters: long enough that a break at word boundaries
 * would leave a third of every visual line empty and add rows to the card. */
const WORDS = Array.from({ length: 10 }, (_, i) => String.fromCharCode(97 + i).repeat(30)).join(
  " ",
);
const WORDY = [
  "diff --git a/src/wordy.ts b/src/wordy.ts",
  "index 3333333..4444444 100644",
  "--- a/src/wordy.ts",
  "+++ b/src/wordy.ts",
  "@@ -1,2 +1,4 @@",
  " const head = 1;",
  `+const a = "${WORDS}";`,
  `+const b = "${WORDS}";`,
  " const tail = 2;",
  "",
].join("\n");

/** Enough cards ahead of it that the one under test is out of the observer's
 * reach at first paint, so its height is the estimate and not a measurement. */
const FILLER = [
  "diff --git a/src/filler.ts b/src/filler.ts",
  "index 5555555..6666666 100644",
  "--- a/src/filler.ts",
  "+++ b/src/filler.ts",
  "@@ -1,60 +1,120 @@",
  ...Array.from({ length: 60 }, (_, i) => ` const line${i} = ${i};`),
  ...Array.from({ length: 60 }, (_, i) => `+const added${i} = ${i};`),
  "",
].join("\n");

function filler(index: number) {
  return {
    path: `src/filler${index}.ts`,
    oldPath: null,
    status: "modified",
    additions: 60,
    deletions: 0,
    patch: FILLER,
    hunks: [],
    omitted: null,
  };
}

const REVIEW = {
  root: "/wrap",
  repositories: [
    {
      path: "repos/one",
      branch: "main",
      base: { mode: "head", ref: "HEAD", sha: "1111111" },
      warnings: [],
      files: [
        {
          path: "src/long.ts",
          oldPath: null,
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: PATCH,
          hunks: [],
          omitted: null,
        },
        filler(1),
        filler(2),
        filler(3),
        {
          path: "src/wordy.ts",
          oldPath: null,
          status: "modified",
          additions: 2,
          deletions: 0,
          patch: WORDY,
          hunks: [],
          omitted: null,
        },
      ],
    },
  ],
  totals: { repositories: 1, files: 5, lines: 183 },
  session: {
    version: 1,
    name: "ui-wrap",
    title: "One very long line",
    base: { mode: "head" },
    createdAt: "2026-09-18T00:00:00Z",
    updatedAt: "2026-09-18T00:00:00Z",
  },
  comments: [],
  counters: {
    counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
    repositories: [],
  },
  warnings: [],
};

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.route("**/api/review", (route) => route.fulfill({ json: REVIEW }));
  await page.route("**/api/activity", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card table.diff").first().waitFor();
}

/** The row the long line is on, and whether its card has a sideways scroll. */
function row(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector(".file-body.mounted") as HTMLElement;
    const cells = [...body.querySelectorAll("td.diff-code")];
    const cell = cells.find((one) => (one.textContent ?? "").includes("xxxxxxxxxx"));
    return {
      height: cell?.getBoundingClientRect().height ?? 0,
      scrolls: body.scrollWidth > body.clientWidth,
      bodyWidth: body.clientWidth,
      tableWidth: body.querySelector("table.diff")?.getBoundingClientRect().width ?? 0,
    };
  });
}

test("a long line wraps inside its column, and the card owns no sideways scroll", async ({
  page,
}) => {
  await open(page);
  const wrapped = await row(page);

  expect(wrapped.scrolls).toBe(false);
  expect(Math.round(wrapped.tableWidth)).toBe(wrapped.bodyWidth);
  expect(wrapped.height).toBeGreaterThan(22);
});

test("scroll gives the old behaviour back: one row, one horizontal scroll", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "scroll", exact: true }).click();
  const straight = await row(page);

  expect(straight.scrolls).toBe(true);
  expect(straight.height).toBe(22);
});

test("the choice survives a reload", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "scroll", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card table.diff").first().waitFor();

  expect((await row(page)).scrolls).toBe(true);
  await page.getByRole("button", { name: "wrap", exact: true }).click();
  expect((await row(page)).scrolls).toBe(false);
});

/** How tall the second card is: the estimate before its diff is mounted, then
 * the real thing. The file of long words is the one that tells them apart. */
async function claimedThenReal(page: Page): Promise<[number, number]> {
  const body = '[data-path="src/wordy.ts"] .file-body';
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.route("**/api/review", (route) => route.fulfill({ json: REVIEW }));
  await page.route("**/api/activity", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await expect(page.locator(`${body} table.diff`)).toHaveCount(0);
  const claimed = await page.evaluate(
    (one: string) => document.querySelector(one)?.getBoundingClientRect().height ?? 0,
    body,
  );
  await page.evaluate(
    (one: string) => document.querySelector(one)?.scrollIntoView(),
    '[data-path="src/wordy.ts"]',
  );
  await page.locator(`${body} table.diff`).waitFor();
  const real = await page.evaluate(
    (one: string) => document.querySelector(one)?.getBoundingClientRect().height ?? 0,
    body,
  );
  return [claimed, real];
}

test("an unmounted card claims a new height when a panel goes", async ({ page }) => {
  // Wide enough that the reading column is not sitting on its 860 px floor: at
  // 1200 px it is, and hiding a panel would change nothing to see.
  await page.setViewportSize({ width: 1900, height: 900 });
  await page.route("**/api/review", (route) => route.fulfill({ json: REVIEW }));
  await page.route("**/api/activity", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);

  const body = '[data-path="src/wordy.ts"] .file-body';
  await expect(page.locator(`${body} table.diff`)).toHaveCount(0);
  const claimed = await page.evaluate(
    (one: string) => document.querySelector(one)?.getBoundingClientRect().height ?? 0,
    body,
  );

  await page.keyboard.press("[");
  await expect(page.locator("nav.sidebar")).toHaveCount(0);
  await expect(page.locator(`${body} table.diff`)).toHaveCount(0);
  const wider = await page.evaluate(
    (one: string) => document.querySelector(one)?.getBoundingClientRect().height ?? 0,
    body,
  );

  // A wider code column is fewer wrapped rows, and the card that has never been
  // drawn says so at once rather than one render late.
  expect(claimed).toBeGreaterThan(0);
  expect(wider).toBeLessThan(claimed);
});

test("the height the card claimed before it mounted is the height it has", async ({ page }) => {
  const [claimed, real] = await claimedThenReal(page);

  // Why `break-all` and not a break at word boundaries: 08-ui.md, the diff.
  expect(claimed).toBeGreaterThan(0);
  expect(Math.abs(real - claimed)).toBeLessThanOrEqual(22);
});
