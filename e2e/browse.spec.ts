import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** Browse mode of DA-37: a file outside the diff read whole, a comment on it, and the real
 * context `↑ N lines` brings above a hunk. What reached the disk is read back with the CLI. */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

/** A send in `AUTO` waits for the model's vote, and the first request loads the model: a deadline
 * only a hang reaches, not a budget ("Waits in the suites", 11-perf.md). */
const SEND_DEADLINE_MS = 60_000;
test.describe.configure({ timeout: 120_000 });

type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  side: string | null;
  body: string;
  anchor: { lineContent: string } | null;
};

function listComments(): Comment[] {
  const out = execFileSync(
    "bun",
    ["run", "src/cli/index.ts", "list", "--json", "--status", "all", "--root", FIXTURE],
    { cwd: root, encoding: "utf-8" },
  );
  return JSON.parse(out) as Comment[];
}

/** A file of the fixture as it is on disk, line by line. */
function onDisk(repo: string, path: string): string[] {
  const lines = readFileSync(join(root, FIXTURE, repo, path), "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card table.diff").first().waitFor();
}

/** The first unchanged file of the `all files` tab, opened; its repository and path. */
async function openUnchanged(page: Page): Promise<{ repo: string; path: string }> {
  await page.getByRole("button", { name: "all files", exact: true }).click();
  await page.locator(".file-row.unchanged").first().click();
  const card = page.locator(".plain-card");
  await card.locator(".plain-line").first().waitFor();
  const repo = (await card.locator(".plain-repo").textContent()) ?? "";
  const path = (await card.locator(".file-path").textContent()) ?? "";
  return { repo, path };
}

test("an unchanged file opens whole and read-only, numbered from 1", async ({ page }) => {
  await open(page);
  const { repo, path } = await openUnchanged(page);
  const card = page.locator(".plain-card");

  await expect(card.locator(".chip")).toHaveText("not in this review");
  await expect(card.getByRole("button", { name: "working tree" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const lines = onDisk(repo, path);
  await expect(card.locator(".plain-ln")).toHaveText(lines.map((_, index) => String(index + 1)));
  await expect(card.locator(".plain-code")).toHaveText(lines);
  await expect(card.locator("textarea, input, [contenteditable]")).toHaveCount(0);
  await expect(page.locator(".status-bar")).toContainText("browsing · read-only");
});

test("a comment left on an unchanged file lands in the session with its path", async ({ page }) => {
  await open(page);
  const { repo, path } = await openUnchanged(page);
  const card = page.locator(".plain-card");

  await card.locator('[data-plain-line="2"]').click();
  const body = `browsed ${Date.now()}`;
  await card.locator(".composer-field").fill(body);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/", {
    timeout: SEND_DEADLINE_MS,
  });

  const written = listComments().find((one) => one.body === body);
  expect(written).toMatchObject({ repo, path, line: 2, side: "new" });
  expect(written?.anchor?.lineContent).toBe(onDisk(repo, path)[1]);
  // And it is drawn under its line, where it was written.
  await expect(card.locator(`[data-thread-anchor="${written?.id}"]`)).toHaveCount(1);
});

/** The new-side number and text of every row a card's diff shows, in order. */
function newRows(page: Page, card: number): Promise<[number, string][]> {
  return page.evaluate((index) => {
    const table = document.querySelectorAll(".file-card")[index]?.querySelector("table.diff");
    if (!table) return [];
    const rows: [number, string][] = [];
    for (const row of table.querySelectorAll("tr.diff-line")) {
      const cells = [...row.children];
      const number = Number(cells[2]?.textContent?.trim() ?? "");
      if (number > 0) rows.push([number, cells[3]?.textContent ?? ""]);
    }
    return rows;
  }, card);
}

test("`↑ 20 lines` above a hunk shows the working tree's lines before it", async ({ page }) => {
  await open(page);
  const total = await page.evaluate(() => window.__perf.files);
  let card = -1;
  for (let index = 0; index < total && card < 0; index += 1) {
    await page.evaluate((i: number) => window.__perf.jumpToFile(i), index);
    const labels = await page
      .locator(".file-card")
      .nth(index)
      .locator("button.hunk-expand")
      .allTextContents();
    if (labels.includes("↑ 20 lines")) card = index;
  }
  expect(card).toBeGreaterThanOrEqual(0);

  const element = page.locator(".file-card").nth(card);
  const repo = (await element.getAttribute("data-repo")) ?? "";
  const path = (await element.getAttribute("data-path")) ?? "";
  const before = new Set((await newRows(page, card)).map(([number]) => number));
  await element.getByRole("button", { name: "↑ 20 lines" }).first().click();
  await expect.poll(async () => (await newRows(page, card)).length).toBe(before.size + 20);

  const lines = onDisk(repo, path);
  const added = (await newRows(page, card)).filter(([number]) => !before.has(number));
  expect(added).toHaveLength(20);
  // Twenty consecutive lines, each the working tree's own text at that number; the library
  // draws an empty line as one space, so the ends are not compared.
  expect(added.at(-1)?.[0]).toBe((added[0]?.[0] ?? 0) + 19);
  for (const [number, text] of added) expect(text.trimEnd()).toBe(lines[number - 1]?.trimEnd());
});

test("B browses the current file and brings the reader back where they were", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__perf.jumpToFile(3));
  // The jump settles over a few frames; the place is read once it has.
  await page.waitForTimeout(300);
  const y = await page.evaluate(() => window.scrollY);
  const current = await page.locator(".file-row.on .file-name").textContent();

  await page.keyboard.press("b");
  await expect(page.locator(".plain-card .file-path")).toHaveText(current ?? "");
  // The file is in the review, so it is not marked as outside it.
  await expect(page.locator(".plain-card .chip")).toHaveCount(0);

  await page.keyboard.press("b");
  await expect(page.locator(".plain-card")).toHaveCount(0);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
});

test("Browse repo on a card opens that file, and back to review leaves it", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  const path = await card.getAttribute("data-path");
  await card.getByRole("button", { name: "Browse repo" }).click();
  await expect(page.locator(".plain-card .file-path")).toHaveText(path ?? "");

  await page.getByRole("button", { name: "← back to review" }).click();
  await expect(page.locator(".plain-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "changes", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

type Bundle = {
  repositories: { path: string; files: { path: string; status: string; patch: string }[] }[];
  comments: Comment[];
};

/** A thread on a line of a changed file that no hunk shows has no row in the card: the rail takes
 * the reader to the file read whole, where the line is (DA-37.1). */
test("a thread outside every hunk of a changed file is reached in browse mode", async ({
  page,
}) => {
  await open(page);
  const bundle = await page.evaluate(
    async () => (await (await fetch("/api/review")).json()) as Bundle,
  );
  // Line 1 of a modified file whose first hunk starts further down.
  let at: { repo: string; path: string } | null = null;
  for (const repo of bundle.repositories) {
    const file = repo.files.find(
      (one) =>
        one.status === "modified" && Number(/@@ -\d+(?:,\d+)? \+(\d+)/.exec(one.patch)?.[1]) > 1,
    );
    if (file !== undefined) {
      at = { repo: repo.path, path: file.path };
      break;
    }
  }
  if (at === null)
    throw new Error("the fixture has no modified file whose first hunk starts past 1");
  const body = `the first line of ${at.path}, far from its hunks`;
  execFileSync(
    "bun",
    [
      "run",
      "src/cli/index.ts",
      "comment",
      "--repo",
      at.repo,
      "--path",
      at.path,
      "--line",
      "1",
      "--severity",
      "nit",
      "--body",
      body,
      "--root",
      FIXTURE,
    ],
    { cwd: root },
  );
  const id = listComments().find((comment) => comment.body === body)?.id as string;
  try {
    // The server hears the CLI's write through its watcher; the page is opened once it has.
    await expect
      .poll(async () =>
        (
          await page.evaluate(async () => (await (await fetch("/api/review")).json()) as Bundle)
        ).comments.some((comment) => comment.id === id),
      )
      .toBe(true);
    await open(page);

    await page.locator(".rail-tabs .tab").nth(1).click();
    await page.locator(`.rail-list [data-thread="${id}"] .thread-focus`).click();

    const card = page.locator(".plain-card");
    await expect(card.locator(".file-path")).toHaveText(at.path);
    const widget = card.locator(`[data-thread-anchor="${id}"]`);
    await expect(widget).toBeInViewport();
    // Under the line it names: the row above the widgets is line 1.
    expect(
      await widget.evaluate((element) =>
        element.closest(".plain-widgets")?.previousElementSibling?.getAttribute("data-plain-line"),
      ),
    ).toBe("1");
  } finally {
    // An open thread an agent wrote and nobody answered is what other specs count and pick.
    execFileSync(
      "bun",
      ["run", "src/cli/index.ts", "resolve", id, "--role", "human", "--root", FIXTURE],
      { cwd: root },
    );
  }
});

/** An agent's edit to the file being browsed reaches the view, in place (DA-37.1). */
test("the browsed file follows an edit to the working tree", async ({ page }) => {
  await open(page);
  const card = page.locator(".file-card").first();
  const repo = (await card.getAttribute("data-repo")) ?? "";
  const path = (await card.getAttribute("data-path")) ?? "";
  await card.getByRole("button", { name: "Browse repo" }).click();
  const plain = page.locator(".plain-card");
  const lines = onDisk(repo, path).length;
  await expect(plain.locator(".plain-line")).toHaveCount(lines);

  const target = join(root, FIXTURE, repo, path);
  const original = readFileSync(target, "utf-8");
  const added = "// an agent added this while the file was being browsed";
  try {
    appendFileSync(target, `${original.endsWith("\n") ? "" : "\n"}${added}\n`);
    // The watcher's frame, a deadline for a hang and not a budget (11-perf.md, "Waits").
    await expect(plain.locator(`[data-plain-line="${lines + 1}"]`)).toHaveText(
      `${lines + 1}${added}`,
      { timeout: 20_000 },
    );
    // In place: the text changed under the reader without a `reading…` in between.
    await expect(plain.locator(".file-note")).toHaveCount(0);
  } finally {
    writeFileSync(target, original);
    // The restore is an edit too: wait for the view to take it, or its frame lands in the next spec.
    await expect(plain.locator(`[data-plain-line="${lines + 1}"]`)).toHaveCount(0, {
      timeout: 20_000,
    });
  }
});

/** The old side of a line outside every hunk is the base's: the rail opens the base whole (DA-37.1). */
test("an old-side thread outside every hunk is reached in browse mode on the base", async ({
  page,
}) => {
  await open(page);
  const bundle = await page.evaluate(
    async () => (await (await fetch("/api/review")).json()) as Bundle,
  );
  // Line 1 of the base of a modified file whose first hunk starts further down on the old side.
  let at: { repo: string; path: string } | null = null;
  for (const repo of bundle.repositories) {
    const file = repo.files.find(
      (one) => one.status === "modified" && Number(/@@ -(\d+)/.exec(one.patch)?.[1]) > 1,
    );
    if (file !== undefined) {
      at = { repo: repo.path, path: file.path };
      break;
    }
  }
  if (at === null)
    throw new Error("the fixture has no modified file whose first hunk starts past 1");
  const body = `the base's first line of ${at.path}, far from its hunks`;
  execFileSync(
    "bun",
    [
      ...["run", "src/cli/index.ts", "comment", "--repo", at.repo, "--path", at.path],
      ...["--line", "1", "--side", "old", "--severity", "nit", "--body", body, "--root", FIXTURE],
    ],
    { cwd: root },
  );
  const id = listComments().find((comment) => comment.body === body)?.id as string;
  try {
    await expect
      .poll(async () =>
        (
          await page.evaluate(async () => (await (await fetch("/api/review")).json()) as Bundle)
        ).comments.some((comment) => comment.id === id),
      )
      .toBe(true);
    await open(page);

    await page.locator(".rail-tabs .tab").nth(1).click();
    await page.locator(`.rail-list [data-thread="${id}"] .thread-focus`).click();

    const card = page.locator(".plain-card");
    await expect(card.locator(".file-path")).toHaveText(at.path);
    await expect(card.locator(".segment.on")).toContainText("base");
    const widget = card.locator(`[data-thread-anchor="${id}"]`);
    await expect(widget).toBeInViewport();
    expect(
      await widget.evaluate((element) =>
        element.closest(".plain-widgets")?.previousElementSibling?.getAttribute("data-plain-line"),
      ),
    ).toBe("1");
  } finally {
    execFileSync(
      "bun",
      ["run", "src/cli/index.ts", "resolve", id, "--role", "human", "--root", FIXTURE],
      { cwd: root },
    );
  }
});
