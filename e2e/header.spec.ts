import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The header of DA-24: the session menu and its create form, the base picker,
 * the two counters that filter the rail, the export, and the scanner warnings.
 * What reached the disk is read back with the CLI, which is the contract the
 * agents get and the only reader that proves the file was written.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";
const SESSION = "synth";

function cli(...args: string[]): string {
  return execFileSync("bun", ["run", "src/cli/index.ts", ...args, "--root", FIXTURE], {
    cwd: root,
    encoding: "utf-8",
  });
}

/** The comments of the current session — no `--review`, so it is `current`. */
function currentComments(): { id: string }[] {
  return JSON.parse(cli("list", "--json", "--status", "all")) as { id: string }[];
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
}

/**
 * Puts the fixture back on the session and the base the other specs expect.
 * Through the API and not the CLI: the server holds the review document until
 * something tells it the session changed, and its own write routes are what
 * tell it — a CLI write is only noticed when the watcher gets round to it.
 *
 * It runs after every test, whatever the test did, so an assertion that failed
 * half way cannot hand the next spec — or the next run — a fixture sitting on a
 * session it invented. `request` rather than the page, because a test that
 * failed before it navigated has no page to evaluate in.
 */
test.afterEach(async ({ request }) => {
  // `data` and not a bodyless post: a write with no content type is
  // form-shaped to the server's `csrf()`, which then wants the
  // `Sec-Fetch-Site` a browser sets and this client does not
  // ([07-server.md](../docs/reference/07-server.md)). The answers are checked,
  // because a refused restore is a silent one and the next spec pays for it.
  const used = await request.post(`/api/sessions/${SESSION}/use`, { data: {} });
  expect(used.ok(), await used.text()).toBe(true);
  const based = await request.put(`/api/sessions/${SESSION}/base`, { data: { base: "head" } });
  expect(based.ok(), await based.text()).toBe(true);
});

/** The same, plus the reload that shows it, for a test that goes on afterwards. */
async function restore(page: Page) {
  await page.evaluate(async (name: string) => {
    const json = { "content-type": "application/json" };
    await fetch(`/api/sessions/${name}/use`, { method: "POST", headers: json });
    await fetch(`/api/sessions/${name}/base`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ base: "head" }),
    });
  }, SESSION);
  await page.reload();
  await page.waitForFunction(() => window.__perf?.ready === true);
  await expect(page.locator(".pill-name").first()).toHaveText(SESSION);
}

test("the menu creates a session and makes it current for the CLI", async ({ page }) => {
  await open(page);
  const name = `ui-${Date.now().toString(36)}`;

  await page.locator(".pill").first().click();
  await page.getByRole("textbox", { name: "name" }).fill(name);
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.locator(".pill-name").first()).toHaveText(name);
  expect(cli("review", "list")).toContain(name);
  // A session of its own is a set of comments of its own, and a new one has none.
  expect(currentComments()).toHaveLength(0);

  await restore(page);
});

test("switching sessions swaps the whole set of threads", async ({ page }) => {
  await open(page);
  const before = await page.locator(".rail-tabs .tab").nth(1).textContent();
  expect(before).not.toBe("Review 0");
  const name = `ui-${Date.now().toString(36)}`;
  cli("review", "new", name, "--base", "head");
  await restore(page);

  await page.locator(".pill").first().click();
  await page.getByRole("button", { name: new RegExp(name) }).click();

  await expect(page.locator(".pill-name").first()).toHaveText(name);
  await expect(page.locator(".rail-tabs .tab").nth(1)).toHaveText("Review 0");

  await restore(page);
});

test("the base picker applies a branch and the repository header says so", async ({ page }) => {
  await open(page);
  const line = page.locator(".repo-base").first();
  await expect(line).toContainText("HEAD");

  await page.getByRole("button", { name: /BASE/ }).click();
  await page.getByRole("button", { name: /^branch/ }).click();
  await page.getByRole("button", { name: "local main" }).first().click();
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(page.locator(".toast")).toContainText("branch:main");
  await expect(line).toContainText("merge-base");
  await expect(page.locator(".pill.base .pill-name")).toHaveText("main");

  await restore(page);
});

test("the raw export is what `diffalanche export` prints", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: "Export .md" }).click();
  await page.getByRole("button", { name: "raw" }).click();

  const shown = await page.locator(".export-raw").textContent();
  expect(shown).toBe(cli("export"));
});

test("the rendered export is the same export, in the same order", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: "Export .md" }).click();
  // The modal asks the server for the export when it opens; nothing is laid out
  // until the answer is there.
  await page.locator(".export-rendered h2").first().waitFor();

  const items = await page.locator(".export-item").count();
  const listed = JSON.parse(cli("list", "--json")) as unknown[];
  expect(items).toBe(listed.length);

  // The two tabs are one export: the headings of `rendered` are the `##` lines
  // of the markdown, in the order the markdown writes them, counts included.
  const headings = await page.locator(".export-rendered h2").allTextContents();
  const written = cli("export")
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).replace(" — ", ""));
  expect(headings).toEqual(written);

  // And the anchors inside the first section come in the same order too.
  const anchors = await page
    .locator(".export-rendered section")
    .first()
    .locator(".export-anchor")
    .allTextContents();
  const inMarkdown = cli("export")
    .split("\n")
    .filter((line) => line.startsWith("- **"))
    .map((line) => line.split("`")[1] ?? "");
  expect(anchors).toEqual(inMarkdown.slice(0, anchors.length));
});

test("a counter filters the rail to what it counted", async ({ page }) => {
  await open(page);
  const awaiting = Number(await page.locator(".counter b.acc").textContent());
  expect(awaiting).toBeGreaterThan(0);

  await page
    .getByRole("button", { name: /awaiting you/ })
    .first()
    .click();

  await expect(page.locator(".rail-tabs .tab").nth(1)).toHaveClass(/\bon\b/);
  await expect(page.locator(".rail-list .thread")).toHaveCount(awaiting);
  await expect(page.locator(".chip.on")).toHaveText("awaiting you");
});

test("the scanner warnings stay away for this session and come back for the next", async ({
  page,
}) => {
  await open(page);
  const bar = page.locator(".warnings");
  await expect(bar).toBeVisible();

  await bar.getByRole("button", { name: "dismiss" }).click();
  await expect(bar).toHaveCount(0);

  // A reload is the same session, and the bar stays away.
  await page.reload();
  await page.waitForFunction(() => window.__perf?.ready === true);
  await expect(page.locator(".warnings")).toHaveCount(0);

  // Another session resolves its own base and has its own warnings to read.
  const name = `ui-${Date.now().toString(36)}`;
  cli("review", "new", name, "--base", "head");
  await restore(page);
  await page.locator(".pill").first().click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.locator(".pill-name").first()).toHaveText(name);

  await expect(page.locator(".warnings")).toBeVisible();
});

test("a letter under an overlay belongs to the overlay", async ({ page }) => {
  await open(page);

  await page.getByRole("button", { name: "Export .md" }).click();
  await page.locator(".export-rendered h2").first().waitFor();
  await page.keyboard.press("c");

  await expect(page.locator('[data-testid="composer"]')).toHaveCount(0);

  // `esc` is what closes one, and `C` works again underneath.
  await page.keyboard.press("Escape");
  await expect(page.locator(".export")).toHaveCount(0);
  await page.keyboard.press("c");
  await expect(page.locator('[data-testid="composer"]')).toHaveCount(1);
});
