import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The composer of DA-22: dragging over the new side of a diff, what the strip
 * says it is anchored to, and what reaches the disk. The comments are read back
 * with the CLI, which is the contract the agents get
 * ([ADR-004](../docs/adr/adr-004-agent-contract.md)) and the only reader that
 * proves the file was written rather than the page updated.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  endLine: number | null;
  severity: string;
  body: string;
};

/** `diffalanche list --json` over the fixture the UI tests run against. */
function listComments(): Comment[] {
  const out = execFileSync(
    "bun",
    ["run", "src/cli/index.ts", "list", "--json", "--status", "all", "--root", FIXTURE],
    { cwd: root, encoding: "utf-8" },
  );
  return JSON.parse(out) as Comment[];
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
}

/** Three lines the change set adds one after another, in the first file card. */
async function threeAddedLines(card: Locator): Promise<[number, number, number]> {
  const lines = await card.evaluate((element) =>
    [...element.querySelectorAll("td.diff-gutter-insert")]
      .map((cell) => Number(cell.textContent))
      .filter((line) => Number.isInteger(line) && line > 0),
  );
  for (let i = 0; i + 2 < lines.length; i += 1) {
    const [a, b, c] = [lines[i] as number, lines[i + 1] as number, lines[i + 2] as number];
    if (b === a + 1 && c === a + 2) return [a, b, c];
  }
  throw new Error(`no three consecutive added lines in the first file card: ${lines.join(",")}`);
}

/** The first line the change set adds in this card: where `C` opens the form. */
async function firstAddedLine(card: Locator): Promise<number> {
  const line = await card.evaluate((element) =>
    Number(element.querySelector("td.diff-gutter-insert")?.textContent),
  );
  if (!Number.isInteger(line) || line <= 0) throw new Error("the first card adds no line");
  return line;
}

/** How many open comments the card's header badge reports, zero when it has none. */
async function badge(card: Locator): Promise<number> {
  const shown = card.locator(".file-head .badge");
  // A card without a badge has no element to read, and waiting for one that
  // will never appear costs the whole test timeout.
  if ((await shown.count()) === 0) return 0;
  return Number(await shown.first().textContent());
}

function gutter(card: Locator, line: number): Locator {
  return card.locator(`td.diff-gutter-insert[data-change-key="I${line}"]`);
}

test("dragging over three lines opens the composer on the range", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  const [first, , last] = await threeAddedLines(card);

  await gutter(card, first).hover();
  await page.mouse.down();
  await gutter(card, last).hover();
  await page.mouse.up();

  const composer = card.locator('[data-testid="composer"]');
  await expect(composer.locator(".composer-anchor")).toContainText(`L${first}–${last} · 3 lines`);
  // The range stays lit above the form it opened.
  await expect(card.locator("td.diff-gutter-selected")).toHaveCount(3);
});

test("esc closes the composer and writes nothing", async ({ page }) => {
  await open(page);
  const before = listComments().length;
  const card = page.locator(".file-card").first();
  const [first] = await threeAddedLines(card);

  await gutter(card, first).click();
  await expect(card.locator('[data-testid="composer"]')).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(card.locator('[data-testid="composer"]')).toHaveCount(0);
  expect(listComments().length).toBe(before);
});

test("⌘⏎ sends the range, and the CLI reads back both its lines", async ({ page }) => {
  await open(page);
  const before = new Set(listComments().map((comment) => comment.id));
  const card = page.locator(".file-card").first();
  const path = await card.getAttribute("data-path");
  const [first, , last] = await threeAddedLines(card);
  const badgeBefore = await badge(card);

  await gutter(card, first).hover();
  await page.mouse.down();
  await gutter(card, last).hover();
  await page.mouse.up();

  await card.locator(".composer-field").fill("the range is wrong here");
  await card.locator(".sev-chip", { hasText: "CRITICAL" }).click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/");

  const written = listComments().filter((comment) => !before.has(comment.id));
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({
    path,
    line: first,
    endLine: last,
    severity: "critical",
    body: "the range is wrong here",
  });
  // The thread is in the store the moment it is saved, not after a reload.
  await expect.poll(() => badge(card)).toBe(badgeBefore + 1);
});

test("a comment on a repository has no path", async ({ page }) => {
  await open(page);
  const before = new Set(listComments().map((comment) => comment.id));

  const section = page.locator(".repo").first();
  await section.getByRole("button", { name: "Comment on repo" }).click();
  const composer = section.locator('[data-testid="repo-composer"]');
  await expect(composer.locator(".composer-anchor")).toContainText("· repository");
  await composer.locator(".composer-field").fill("this repository needs a changelog");
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/");

  const written = listComments().filter((comment) => !before.has(comment.id));
  expect(written).toHaveLength(1);
  expect(written[0]?.path).toBeNull();
  expect(written[0]?.repo).not.toBeNull();
});

test("a comment on the review has no repository", async ({ page }) => {
  await open(page);
  const before = new Set(listComments().map((comment) => comment.id));

  await page.locator(".pill").first().click();
  await page.getByRole("button", { name: "Comment on review" }).click();
  const composer = page.locator('[data-testid="review-composer"]');
  await expect(composer.locator(".composer-anchor")).toHaveText("→ review");
  await composer.locator(".composer-field").fill("the whole review is missing a title");
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/");

  const written = listComments().filter((comment) => !before.has(comment.id));
  expect(written).toHaveLength(1);
  expect(written[0]?.repo).toBeNull();
});

test("C opens the composer on the first added line of the file being read", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  const first = await firstAddedLine(card);

  await page.keyboard.press("c");

  const composer = card.locator('[data-testid="composer"]');
  await expect(composer.locator(".composer-anchor")).toContainText(`L${first} · 1 line`);
});

test("a comment on a file has no line, and its form opens under the card header", async ({
  page,
}) => {
  await open(page);
  const before = new Set(listComments().map((comment) => comment.id));
  const card = page.locator(".file-card").first();
  const path = await card.getAttribute("data-path");

  await card.getByRole("button", { name: "Comment on file" }).click();
  const composer = card.locator('[data-testid="file-composer"]');
  await expect(composer.locator(".composer-anchor")).toHaveText(`→ ${path} · file`);
  await composer.locator(".composer-field").fill("this file needs a test");
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/");

  const written = listComments().filter((comment) => !before.has(comment.id));
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({ path, line: null, endLine: null });
});

test("C opens the form on a collapsed card, which stops being collapsed", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  await card.locator(".file-head .caret").click();
  await expect(card.locator(".diff")).toHaveCount(0);

  await page.keyboard.press("c");

  await expect(card.locator('[data-testid="composer"]')).toBeVisible();
});
