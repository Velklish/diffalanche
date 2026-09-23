import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The repository boundary of DA-54: the bar that says which repository is being
 * read, the hairline between two sections, and the two jumps to a repository —
 * from the tree and from a thread card. The heights the assertions use are the
 * handoff's: 52 px of header and 38 px of bar under it.
 */

const HEADER = 52;
const BAR = 38;

type Box = { top: number; bottom: number; path: string };

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".repo-row").first().waitFor();
}

/** Every repository bar on the page, in the order the reading column lists them. */
function bars(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".repo-head")].map((bar) => {
      const box = bar.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        path: bar.querySelector(".repo-path")?.textContent ?? "",
      };
    }),
  );
}

/** The top of a repository's section, in the viewport. */
function sectionTop(page: Page, repo: string): Promise<number> {
  return page.evaluate(
    (path) =>
      document.querySelector(`[data-repo-section="${CSS.escape(path)}"]`)?.getBoundingClientRect()
        .top ?? Number.NaN,
    repo,
  );
}

/** The paths the tree lists, which is the order the sections are in. */
function repositories(page: Page): Promise<string[]> {
  return page.locator(".repo-row .repo-name").allTextContents();
}

/** Scrolls, then waits out one 120 ms `SETTLE_MS` of the centre panel by an equal timer set after the
 * scroll event; a scroll the page makes later re-arms it, so what `pick` chose is polled for. */
async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate(async (top) => {
    window.scrollTo({ top, behavior: "instant" });
    // Scroll events are dispatched before the frame's animation callbacks.
    await new Promise((done) => requestAnimationFrame(done));
    await new Promise((done) => setTimeout(done, 120));
    await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
  }, y);
}

test("the bar of the repository being read is the one under the header", async ({ page }) => {
  await open(page);
  const [, second] = await repositories(page);
  if (second === undefined) throw new Error("the fixture has fewer than two repositories");

  // The middle of the second repository: far enough in that the first one is
  // behind and the third has not arrived.
  const middle = await page.evaluate((path) => {
    const box = document
      .querySelector(`[data-repo-section="${CSS.escape(path)}"]`)
      ?.getBoundingClientRect();
    if (!box) throw new Error(`no section for ${path}`);
    return window.scrollY + box.top + box.height / 2;
  }, second);
  await scrollTo(page, middle);

  const [first, current] = await bars(page);
  expect(current?.path).toBe(second);
  expect(current?.top).toBeCloseTo(HEADER, 0);
  expect(current?.bottom).toBeCloseTo(HEADER + BAR, 0);
  // The bar of the repository that has been read is gone with its section, not
  // stacked over the header.
  expect(first?.bottom).toBeLessThanOrEqual(0);
});

test("the arriving bar pushes the previous one out at the boundary", async ({ page }) => {
  await open(page);
  const [, second] = await repositories(page);
  if (second === undefined) throw new Error("the fixture has fewer than two repositories");

  // Just before the boundary: the second section's top is inside the strip the
  // first repository's bar is stuck in, which is where one pushes the other.
  const boundary = await page.evaluate(
    ({ path, offset }) => {
      const box = document
        .querySelector(`[data-repo-section="${CSS.escape(path)}"]`)
        ?.getBoundingClientRect();
      if (!box) throw new Error(`no section for ${path}`);
      return window.scrollY + box.top - offset;
    },
    { path: second, offset: HEADER + BAR / 2 },
  );
  await scrollTo(page, boundary);

  const pushing = await bars(page);
  const leaving = pushing[0];
  const arriving = pushing[1];
  if (leaving === undefined || arriving === undefined) throw new Error("two bars were expected");
  // The leaving bar has been lifted off its sticky position by the arriving
  // one, and the two do not overlap: one bar per repository, never a stack.
  expect(leaving.top).toBeLessThan(HEADER);
  expect(leaving.bottom).toBeLessThanOrEqual(arriving.top + 1);

  // One bar height further on, the first one is behind the header and the
  // second is in its place.
  await scrollTo(page, boundary + BAR + 1);
  const after = await bars(page);
  expect(after[0]?.bottom).toBeLessThanOrEqual(HEADER);
  expect(after[1]?.top).toBeCloseTo(HEADER, 0);
});

test("a hairline marks every boundary and there is none above the first", async ({ page }) => {
  await open(page);

  const borders = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".repo")].map((section) => {
      const style = getComputedStyle(section);
      return { width: style.borderTopWidth, colour: style.borderTopColor };
    }),
  );
  expect(borders.length).toBeGreaterThan(1);

  const [first, ...rest] = borders;
  // The first section opens the column; a line above it would be a boundary
  // with nothing on the other side.
  expect(first?.width).toBe("0px");
  // The token is resolved by the browser rather than parsed here: whatever
  // notation `--bd2` is written in, both sides of the comparison come back in
  // the one `getComputedStyle` answers in.
  const hairline = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.borderTopColor = "var(--bd2)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).borderTopColor;
    probe.remove();
    return colour;
  });
  for (const section of rest) {
    expect(section.width).toBe("1px");
    expect(section.colour).toBe(hairline);
  }
});

test("the tree still follows the reading position under the bar", async ({ page }) => {
  await open(page);
  const paths = await repositories(page);
  const third = paths[2];
  if (third === undefined) throw new Error("the fixture has fewer than three repositories");

  const into = await page.evaluate((path) => {
    const box = document
      .querySelector(`[data-repo-section="${CSS.escape(path)}"]`)
      ?.getBoundingClientRect();
    if (!box) throw new Error(`no section for ${path}`);
    return window.scrollY + box.top + box.height / 2;
  }, third);
  await scrollTo(page, into);

  // The probe asks which card is under the header and the bar; if it asked
  // inside the bar it would hit the bar and the selection would never move.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".file-row.on")?.closest(".branch")?.querySelector(".repo-name")
            ?.textContent ?? null,
      ),
    )
    .toBe(third);
});

test("the name in the tree jumps and the caret only collapses", async ({ page }) => {
  await open(page);
  const paths = await repositories(page);
  const third = paths[2];
  if (third === undefined) throw new Error("the fixture has fewer than three repositories");

  const branch = page.locator(".branch").nth(2);
  const files = await branch.locator(".file-row").count();
  expect(files).toBeGreaterThan(0);

  await branch.locator(".repo-name").click();
  // The section top lands under the header, and the bar is in its sticky place
  // right below it.
  await expect.poll(() => sectionTop(page, third)).toBeGreaterThanOrEqual(HEADER - 1);
  expect(await sectionTop(page, third)).toBeLessThan(HEADER + 10);
  // A jump is not a collapse.
  await expect(branch.locator(".file-row")).toHaveCount(files);
  await expect(branch.locator(".repo-row")).toHaveAttribute("aria-expanded", "true");

  const before = await page.evaluate(() => window.scrollY);
  await branch.locator(".repo-toggle").click();
  await expect(branch.locator(".file-row")).toHaveCount(0);
  // A collapse is not a jump.
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("on the row Enter jumps and Space collapses", async ({ page }) => {
  await open(page);
  const paths = await repositories(page);
  const third = paths[2];
  if (third === undefined) throw new Error("the fixture has fewer than three repositories");

  const branch = page.locator(".branch").nth(2);
  const files = await branch.locator(".file-row").count();
  await branch.locator(".repo-row").focus();

  await page.keyboard.press("Enter");
  await expect.poll(() => sectionTop(page, third)).toBeGreaterThanOrEqual(HEADER - 1);
  expect(await sectionTop(page, third)).toBeLessThan(HEADER + 10);
  // Enter went to the repository and left the branch open.
  await expect(branch.locator(".file-row")).toHaveCount(files);

  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(" ");
  await expect(branch.locator(".file-row")).toHaveCount(0);
  // Space put the branch away and did not move the page.
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // Both keys were reached from one tab stop: the row still holds the focus.
  await expect(branch.locator(".repo-row")).toBeFocused();
});

test("the repository of a thread card jumps to its section", async ({ page }) => {
  await open(page);
  // The repository is named on the tab that spans the review; on the file's own
  // tab it would be the same word on every card.
  await page.locator(".rail-tabs .tab").nth(1).click();

  const repo = page.locator(".thread-repo").first();
  await repo.waitFor();
  const path = await repo.getAttribute("title");
  if (path === null) throw new Error("the thread card names no repository");

  // From the far end of the document, so the jump has somewhere to go: at the
  // top of the page a card of the first repository would be all but arrived
  // already, and the test would pass without the click doing anything.
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
  );
  const before = await page.evaluate(() => window.scrollY);

  await repo.click();
  await expect.poll(() => sectionTop(page, path)).toBeGreaterThanOrEqual(HEADER - 1);
  expect(await sectionTop(page, path)).toBeLessThan(HEADER + 10);
  expect(await page.evaluate(() => window.scrollY)).not.toBe(before);
});
