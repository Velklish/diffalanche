import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The thread rail of DA-23: what it lists on each of its two tabs, the
 * `unanswered` filter, the focus that runs both ways between a card and its
 * anchor, and the three writes. What reached the disk is read back with the
 * CLI, which is the contract the agents get.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  status: string;
  severity: string;
  author: string;
  replies: { author: string; role: string; body: string }[];
};

function listComments(status: "open" | "all" = "all"): Comment[] {
  const out = execFileSync(
    "bun",
    ["run", "src/cli/index.ts", "list", "--json", "--status", status, "--root", FIXTURE],
    { cwd: root, encoding: "utf-8" },
  );
  return JSON.parse(out) as Comment[];
}

type Review = { comments: Comment[] };

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
}

function review(page: Page): Promise<Review> {
  return page.evaluate(async () => (await (await fetch("/api/review")).json()) as Review);
}

/**
 * A thread on a line, focused from the tab that spans the whole review. The
 * rail is what makes that thread's file the current one, so the test never has
 * to name a file in the tree — the small fixture repeats file names across
 * repositories, and a row picked by name is not the row of this thread.
 */
async function focusOneThread(page: Page): Promise<Comment> {
  await open(page);
  const bundle = await review(page);
  const thread = bundle.comments.find(
    (comment) => comment.repo !== null && comment.path !== null && comment.line !== null,
  );
  if (thread === undefined) throw new Error("the fixture has no line comment");
  await page.locator(".rail-tabs .tab").nth(1).click();
  await page.locator(`.rail-list [data-thread="${thread.id}"] .thread-head`).click();
  return thread;
}

test("the file tab lists this file's threads and the review tab lists them all", async ({
  page,
}) => {
  const thread = await focusOneThread(page);
  const bundle = await review(page);
  const here = bundle.comments.filter(
    (comment) => comment.repo === thread.repo && comment.path === thread.path,
  );
  const open = (of: Comment[]) => of.filter((comment) => comment.status === "open").length;

  // The tabs count what is still to be done, like every other number on the
  // screen; a resolved thread is listed but not counted.
  await expect(page.locator(".rail-tabs .tab").nth(1)).toHaveText(
    `Review ${open(bundle.comments)}`,
  );
  await expect(page.locator(".rail-list .thread")).toHaveCount(bundle.comments.length);

  await page.locator(".rail-tabs .tab").first().click();
  await expect(page.locator(".rail-tabs .tab").first()).toHaveText(`This file ${open(here)}`);
  await expect(page.locator(".rail-list .thread")).toHaveCount(here.length);
});

test("the unanswered chip keeps the threads no agent has answered", async ({ page }) => {
  await focusOneThread(page);
  const bundle = await review(page);
  const unanswered = bundle.comments.filter(
    (comment) => comment.status === "open" && (comment.replies.at(-1)?.role ?? "human") === "human",
  );
  expect(unanswered.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "unanswered" }).click();

  await expect(page.locator(".rail-list .thread")).toHaveCount(unanswered.length);
});

test("a card and its anchor point at each other", async ({ page }) => {
  const thread = await focusOneThread(page);
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);

  // The card brought the diff to the widget that sits under the anchored line.
  const widget = page.locator(`[data-thread-anchor="${thread.id}"]`);
  await expect(widget).toBeInViewport();
  await expect(card).toHaveClass(/\bon\b/);
  // And it does not take the diff sideways with it.
  const fileCard = page.locator(`.file-card[data-path="${thread.path}"]`).first();
  expect(await fileCard.locator(".file-body").evaluate((body) => body.scrollLeft)).toBe(0);
  // The line carries a bar in the colour of the thread on it.
  await expect(fileCard.locator(`.diff-line.marked.${thread.severity}`)).not.toHaveCount(0);

  // And the widget under the line brings the focus back to the card.
  await page.locator(".rail-tabs .tab").first().click();
  await page.locator(`[data-thread-anchor="${thread.id}"] .thread-head`).click();
  await expect(page.locator(".rail-list .thread.on")).toHaveCount(1);
});

test("resolve takes the thread out of the open list, and reopen brings it back", async ({
  page,
}) => {
  const thread = await focusOneThread(page);
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);

  await card.getByRole("button", { name: "Resolve" }).click();
  await expect(card).toHaveClass(/resolved/);
  await expect
    .poll(() => listComments("open").some((comment) => comment.id === thread.id))
    .toBe(false);

  await card.getByRole("button", { name: "Reopen" }).click();
  await expect(card).not.toHaveClass(/resolved/);
  await expect
    .poll(() => listComments("open").some((comment) => comment.id === thread.id))
    .toBe(true);
});

test("a reply from the rail is written as the configured author with role human", async ({
  page,
}) => {
  const thread = await focusOneThread(page);
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);

  await card.getByRole("button", { name: "Reply" }).click();
  await card.locator(".reply-field").fill("done in the next commit");
  await card.getByRole("button", { name: "Send" }).click();

  await expect(card.locator(".reply .reply-body")).toContainText("done in the next commit");
  const written = listComments().find((comment) => comment.id === thread.id);
  const reply = written?.replies.at(-1);
  expect(reply).toMatchObject({ role: "human", body: "done in the next commit" });
  expect(reply?.author).not.toBe("");
});

test("a thread whose line is not mounted is still listed and still clickable", async ({ page }) => {
  await open(page);
  const bundle = await review(page);
  const thread = bundle.comments.find(
    (comment) => comment.repo !== null && comment.path !== null && comment.line !== null,
  );
  if (thread === undefined) throw new Error("the fixture has no line comment");

  // The review tab holds every thread whatever is on screen; the card of this
  // one is far enough down that its diff has never been mounted.
  await page.locator(".rail-tabs .tab").nth(1).click();
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  await expect(card).toBeVisible();

  await card.locator(".thread-head").click();
  await expect(page.locator(`[data-thread-anchor="${thread.id}"]`)).toBeInViewport();
});

test("a thread on a line the collapsed context hides is reached by showing it again", async ({
  page,
}) => {
  await open(page);
  const card = page.locator(".file-card").first();

  // A context line that leads a hunk: `collapse context` is exactly what takes
  // it away, so a thread on it is the case the rail has to answer for. Both
  // gutters of a normal row carry the same change key; the new side is the
  // second of them.
  const key = await card.evaluate((element) => {
    const rows = [...element.querySelectorAll("tr")];
    const start = rows.findIndex((row) => row.classList.contains("diff-decoration"));
    for (const row of rows.slice(start + 1)) {
      if (row.querySelector(".diff-code-insert, .diff-code-delete")) return null;
      const gutter = row.querySelector("td.diff-gutter[data-change-key^='N']");
      if (gutter) return gutter.getAttribute("data-change-key");
    }
    return null;
  });
  if (key === null) throw new Error("the first hunk begins with a change, not with context");

  const before = new Set(listComments().map((comment) => comment.id));
  await card.locator(`td.diff-gutter[data-change-key="${key}"]`).nth(1).click();
  await card.locator(".composer-field").fill("this context line is the wrong one");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/");

  const written = listComments().find((comment) => !before.has(comment.id));
  const anchor = page.locator(`[data-thread-anchor="${written?.id}"]`);
  await expect(anchor).toHaveCount(1);

  // Collapsing takes the line away, and the widget with it.
  await card.getByRole("button", { name: "collapse context" }).first().click();
  await expect(anchor).toHaveCount(0);

  // The rail still lists the thread, and asking for it shows the context again.
  await page.locator(".rail-tabs .tab").nth(1).click();
  await page.locator(`.rail-list [data-thread="${written?.id}"] .thread-head`).click();
  await expect(anchor).toHaveCount(1);
  await expect(anchor).toBeInViewport();
});
