import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** The symbol index of DA-39 through global search: a class the fixture defines is listed by its
 * name with the `symbol` tag, and `⏎` opens its file in browse mode at the definition. */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = join(root, ".perf/e2e");

/** A C# class the fixture defines: its repository, file, line and name, read off the disk. */
function knownClass(): { repo: string; path: string; line: number; name: string } {
  for (const group of readdirSync(join(FIXTURE, "repos"))) {
    for (const name of readdirSync(join(FIXTURE, "repos", group))) {
      const repo = `repos/${group}/${name}`;
      const walk = (at: string): { path: string; line: number; name: string } | null => {
        for (const entry of readdirSync(join(FIXTURE, repo, at), { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const path = at === "" ? entry.name : `${at}/${entry.name}`;
          if (entry.isDirectory()) {
            const found = walk(path);
            if (found !== null) return found;
          } else if (path.endsWith(".cs")) {
            const lines = readFileSync(join(FIXTURE, repo, path), "utf8").split("\n");
            const at = lines.findIndex((line) => /public sealed class (\w+)/.test(line));
            const match = at < 0 ? null : /public sealed class (\w+)/.exec(lines[at] as string);
            if (match?.[1] !== undefined) return { path, line: at + 1, name: match[1] };
          }
        }
        return null;
      };
      const found = walk("");
      if (found !== null && !repo.endsWith("-worktree")) return { repo, ...found };
    }
  }
  throw new Error("the fixture defines no C# class");
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card table.diff").first().waitFor();
}

test("a class name lists its definition with the symbol tag, and ⏎ opens it there", async ({
  page,
}) => {
  const known = knownClass();
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill(known.name);

  const row = page.locator(".palette-hit:has(.palette-tag.symbol)").first();
  await expect(row.locator(".palette-name")).toHaveText(known.name);
  await row.hover();
  await expect(page.locator(".palette-line.on")).toContainText(`class ${known.name}`);
  await page.keyboard.press("Enter");

  await expect(page.locator(".plain-card .file-path")).toHaveText(known.path);
  const target = page.locator(`[data-plain-line="${known.line}"]`);
  await expect(target).toBeInViewport();
  await expect(target.locator(".plain-code")).toContainText(`class ${known.name}`);
});

test("a refusal of the symbol search is said under the list, not swallowed", async ({ page }) => {
  await page.route("**/api/search/symbols?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "internal", message: "the grammar would not load" }),
    }),
  );
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill("resolver");
  await expect(page.locator(".palette-capped")).toContainText("the grammar would not load");
});
