import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The keyboard map and global search of DA-26: every row of the handoff's table
 * on the fixture, and the modal it opens. What a key wrote is read back with
 * the CLI, which is what proves the file changed and not only the store.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  status: string;
  body: string;
};

function cli(...args: string[]): string {
  return execFileSync("bun", ["run", "src/cli/index.ts", ...args, "--root", FIXTURE], {
    cwd: root,
    encoding: "utf-8",
  });
}

function comments(status: "open" | "all" = "all"): Comment[] {
  return JSON.parse(cli("list", "--json", "--status", status)) as Comment[];
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
}

const palette = (page: Page) => page.getByRole("dialog", { name: "global search" });

test("⌘K opens global search and esc closes it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  // The field has the focus the moment it opens: the reader types, not clicks.
  await expect(page.getByRole("textbox", { name: "search" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
});

test("two presses of shift open the same modal, and close it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
  await expect(palette(page)).toBeVisible();

  // From inside the modal's own field, which has the focus: `⇧⇧` is documented
  // as a toggle, and this is the half of it the field rule would have swallowed.
  await expect(page.getByRole("textbox", { name: "search" })).toBeFocused();
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
  await expect(palette(page)).toBeHidden();
});

test("a file name lists its card and ⏎ scrolls to it", async ({ page }) => {
  await open(page);
  const bundle = await page.evaluate(
    async () =>
      (await (await fetch("/api/review")).json()) as {
        repositories: { path: string; files: { path: string }[] }[];
      },
  );
  // The last file of the last repository: far enough down that it is only in
  // view if the ⏎ actually scrolled there.
  const repo = bundle.repositories.at(-1) as { path: string; files: { path: string }[] };
  const file = repo.files.at(-1) as { path: string };
  const id = `${repo.path}/${file.path}`;

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill(id);
  const first = palette(page).locator(".palette-hit").first();
  await expect(first).toContainText(file.path);
  await expect(first.locator(".palette-tag")).toHaveText("file");
  await expect(palette(page).locator(".palette-path")).toHaveText(file.path);

  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page.locator(`[data-file="${id}"]`)).toBeInViewport();
});

test("a word of a comment lists the thread with its line in the preview", async ({ page }) => {
  await open(page);
  const thread = comments("open").find(
    (comment) => comment.line !== null && comment.body.trim() !== "",
  );
  if (thread === undefined) throw new Error("the fixture has no open thread on a line");
  const word = (thread.body.split(/\s+/).find((one) => one.length > 5) ??
    thread.body.trim()) as string;

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill(word);
  const hit = palette(page).locator(".palette-hit", { hasText: word }).first();
  await expect(hit).toBeVisible();
  await hit.hover();
  // Hovering selects, so the preview follows the pointer without a click.
  await expect(hit).toHaveClass(/on/);
  await expect(palette(page).locator(".palette-meta")).toContainText(`L${thread.line}`);
  await expect(palette(page).locator(".palette-line.on")).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page.locator(`.rail-list [data-thread="${thread.id}"]`)).toHaveClass(/on/);
});

test("J walks the open threads and wraps at the end", async ({ page }) => {
  await open(page);
  // Every open thread, the ones anchored to the whole review included: `J`
  // walks those too, and a count that left them out would stop one short of
  // where it started.
  const walk = comments("open");
  if (walk.length < 2) throw new Error("the fixture has fewer than two open threads");

  await page.getByRole("button", { name: /^Review / }).click();
  await page.keyboard.press("j");
  const first = await page.locator(".rail-list .thread.on").first().getAttribute("data-thread");
  expect(first).not.toBeNull();

  // Once round the whole review comes back to where it started.
  for (let step = 0; step < walk.length; step += 1) await page.keyboard.press("j");
  await expect(page.locator(`.rail-list [data-thread="${first}"]`)).toHaveClass(/on/);

  await page.keyboard.press("k");
  await expect(page.locator(`.rail-list [data-thread="${first}"]`)).not.toHaveClass(/\bon\b/);
});

test("an open overlay keeps the focus, and gives it back when it closes", async ({ page }) => {
  await open(page);
  // Exactly that name: a repository row's own name contains the word too.
  const search = page.getByRole("button", { name: "search", exact: true });
  await search.click();
  await expect(palette(page)).toBeVisible();

  // Round the panel and back into it: a `Tab` may not reach the page behind a
  // scrim the reader cannot see through.
  const stops = await palette(page)
    .locator(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    .count();
  for (let step = 0; step < stops + 1; step += 1) await page.keyboard.press("Tab");
  expect(await palette(page).evaluate((panel) => panel.contains(document.activeElement))).toBe(
    true,
  );

  // And out again by the door it came in: the control that opened it.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await expect(search).toBeFocused();
});

test("B says that browsing is Phase 2 and changes nothing", async ({ page }) => {
  await open(page);
  await page.keyboard.press("b");
  await expect(page.locator(".toast")).toContainText("DA-37");
});

test("C opens the composer and R resolves the focused thread", async ({ page }) => {
  await open(page);
  await page.keyboard.press("c");
  await expect(page.locator(".composer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".composer")).toBeHidden();

  await page.getByRole("button", { name: /^Review / }).click();
  await page.keyboard.press("j");
  const id = await page.locator(".rail-list .thread.on").first().getAttribute("data-thread");
  if (id === null) throw new Error("`J` focused no thread");

  await page.keyboard.press("r");
  await expect(page.locator(`.rail-list [data-thread="${id}"]`)).toHaveClass(/resolved/);
  expect(comments().find((comment) => comment.id === id)?.status).toBe("resolved");
});

test("a letter typed into the composer is text, not a command", async ({ page }) => {
  await open(page);
  await page.keyboard.press("c");
  const field = page.locator(".composer-field");
  await field.click();
  await field.type("jkrb and a border case");

  await expect(field).toHaveValue("jkrb and a border case");
  await expect(palette(page)).toBeHidden();
  await expect(page.locator(".toast")).toBeHidden();
  // Two shifts inside a field are capital letters, not a search: the handoff's
  // exception list has `⌘K`, `⌘⏎` and `esc`, and not `⇧⇧`.
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
  await expect(palette(page)).toBeHidden();
  // `⌘K` is on that list, and works from where the reader is.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeVisible();
  // One `esc` closes the modal and leaves what is being written alone.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
  await expect(field).toHaveValue("jkrb and a border case");
});
