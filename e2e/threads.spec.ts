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
  await page.locator(`.rail-list [data-thread="${thread.id}"] .thread-focus`).click();
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
  await page.locator(`[data-thread-anchor="${thread.id}"] .thread-focus`).click();
  await expect(page.locator(".rail-list .thread.on")).toHaveCount(1);
});

test("the whole header focuses the thread, and only the repository leaves it", async ({ page }) => {
  await open(page);
  const bundle = await review(page);
  const thread = bundle.comments.find((comment) => comment.repo !== null && comment.path !== null);
  if (thread === undefined) throw new Error("the fixture has no thread on a file");
  await page.locator(".rail-tabs .tab").nth(1).click();

  // The severity chip and the state sit inside the focus click, not beside it:
  // pressing the chip focuses the thread, as pressing anywhere in the header
  // did before the repository became a target of its own (DA-54).
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  await card.locator(".sev-tag").click();
  await expect(card).toHaveClass(/\bon\b/);
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

/** One thread is on screen twice, and only the copy `Reply` was pressed on
 * draws the field and takes the caret (DA-94). */
test("Reply opens one field, in the copy it was pressed on", async ({ page }) => {
  const thread = await focusOneThread(page);
  const widget = page.locator(`[data-thread-anchor="${thread.id}"]`);
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  // Both copies are on screen: the rail is on the file the widget belongs to.
  await expect(widget).toHaveCount(1);
  await expect(card).toHaveCount(1);

  await widget.getByRole("button", { name: "Reply" }).click();
  await expect(page.locator(".reply-field")).toHaveCount(1);
  await expect(widget.locator(".reply-field")).toBeFocused();

  // And the other way round, from the rail.
  await widget.getByRole("button", { name: "Reply" }).click();
  await expect(page.locator(".reply-field")).toHaveCount(0);
  await card.getByRole("button", { name: "Reply" }).click();
  await expect(page.locator(".reply-field")).toHaveCount(1);
  await expect(card.locator(".reply-field")).toBeFocused();
});

/** Since DA-94 the rail does not draw the field the widget owns, so the card
 * holding it may not be unmounted from under the caret (ADR-008). */
test("a reply being written in a widget keeps its card mounted", async ({ page }) => {
  // The heaviest case here — a whole review, a reveal, and a scroll that
  // unmounts cards — and it ran past the default once under load.
  test.setTimeout(60_000);
  const thread = await focusOneThread(page);
  const widget = page.locator(`[data-thread-anchor="${thread.id}"]`);
  await widget.getByRole("button", { name: "Reply" }).click();
  await widget.locator(".reply-field").fill("still here");

  // The far end of the review, well past the card's 1000 px mount margin.
  const card = page.locator(`.file-card[data-path="${thread.path}"]`).first();
  await expect(card.locator(".file-body.mounted")).toHaveCount(1);
  // A mounted neighbour with no field in it: its unmount is the proof the scroll has been through
  // the observer, where a sleep of 400 ms only hoped it had (11-perf.md, "Waits").
  const neighbour = await page.evaluate((path) => {
    const cards = [...document.querySelectorAll<HTMLElement>(".file-card")];
    const at = cards.findIndex((one) => one.dataset.path === path);
    const beside = [cards[at - 1], cards[at + 1]].find(
      (one) => one?.querySelector(".file-body.mounted") != null,
    );
    return beside === undefined ? -1 : cards.indexOf(beside);
  }, thread.path);
  if (neighbour < 0) throw new Error("no mounted card beside the one holding the field");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator(".file-card").nth(neighbour).locator(".file-body.mounted")).toHaveCount(
    0,
  );

  await expect(page.locator(".reply-field")).toHaveCount(1);
  await expect(page.locator(".reply-field")).toHaveValue("still here");
});

test("a thread with no widget opens its field in the rail", async ({ page }) => {
  await open(page);
  const bundle = await review(page);
  // A comment on a whole file has no line, so it has no row to sit under and
  // the rail is the only place it is drawn (FileCard drops it).
  const thread = bundle.comments.find(
    (comment) => comment.repo !== null && comment.path !== null && comment.line === null,
  );
  if (thread === undefined) throw new Error("the fixture has no file-level comment");
  await page.locator(".rail-tabs .tab").nth(1).click();

  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  await expect(page.locator(`[data-thread-anchor="${thread.id}"]`)).toHaveCount(0);
  await card.getByRole("button", { name: "Reply" }).click();

  await expect(page.locator(".reply-field")).toHaveCount(1);
  await expect(card.locator(".reply-field")).toBeFocused();
});

test("a reply from the rail is written as the configured author with role human", async ({
  page,
}) => {
  const thread = await focusOneThread(page);
  // `.rail-list` on purpose: the rail's own `Reply` is what this case is about,
  // and the same thread is drawn under its line as well (DA-94).
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

  await card.locator(".thread-focus").click();
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
  await page.locator(`.rail-list [data-thread="${written?.id}"] .thread-focus`).click();
  await expect(anchor).toHaveCount(1);
  await expect(anchor).toBeInViewport();
});
