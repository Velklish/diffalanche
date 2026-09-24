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

/** A send in `AUTO` waits for the model's vote, and the first request loads the model: a deadline
 * only a hang reaches, not a budget ("Waits in the suites", 11-perf.md). */
const SEND_DEADLINE_MS = 60_000;
test.describe.configure({ timeout: 120_000 });

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
  await expect(page.locator(".toast")).toContainText("Комментарий сохранён в reviews/", {
    timeout: SEND_DEADLINE_MS,
  });

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

type Bundle = {
  repositories: { path: string; files: { path: string; status: string; patch: string }[] }[];
  comments: (Comment & { body: string })[];
};

/** A deleted line whose number the new side shows too, in the first modified file that has one:
 * where a card reading every thread as new-side put an old one (DA-37.2). */
function collision(bundle: Bundle): { repo: string; path: string; line: number } {
  for (const repo of bundle.repositories) {
    for (const file of repo.files) {
      if (file.status !== "modified") continue;
      const deleted: number[] = [];
      const shown = new Set<number>();
      let old = 0;
      let now = 0;
      for (const row of file.patch.split("\n")) {
        const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(row);
        if (head) {
          old = Number(head[1]);
          now = Number(head[2]);
        } else if (row.startsWith("-") && !row.startsWith("---")) {
          deleted.push(old++);
        } else if (row.startsWith("+") && !row.startsWith("+++")) {
          shown.add(now++);
        } else if (row.startsWith(" ")) {
          old += 1;
          shown.add(now++);
        }
      }
      const line = deleted.find((one) => shown.has(one));
      if (line !== undefined) return { repo: repo.path, path: file.path, line };
    }
  }
  throw new Error("the fixture has no deleted line whose number the new side shows");
}

/** An agent's comment written from a shell, once the server has it; `done` resolves it, since an
 * open thread nobody answered is what other specs count and pick. */
async function written(page: Page, args: string[]): Promise<{ id: string; done: () => void }> {
  const body = `written from a shell at ${Date.now()}, ${Math.random().toString(36).slice(2)}`;
  execFileSync(
    "bun",
    ["run", "src/cli/index.ts", "comment", ...args, "--body", body, "--root", FIXTURE],
    { cwd: root, encoding: "utf-8" },
  );
  let id: string | undefined;
  await expect
    .poll(async () => {
      const bundle = await page.evaluate(
        async () => (await (await fetch("/api/review")).json()) as Bundle,
      );
      id = bundle.comments.find((comment) => comment.body === body)?.id;
      return id !== undefined;
    })
    .toBe(true);
  const found = id as string;
  const done = () => {
    execFileSync(
      "bun",
      ["run", "src/cli/index.ts", "resolve", found, "--role", "human", "--root", FIXTURE],
      { cwd: root },
    );
  };
  return { id: found, done };
}

/** The first mounted row of a card that `pick` accepts, with its card and its gutters' numbers. */
async function firstRow(
  page: Page,
  pick: "pair" | "context",
): Promise<{ repo: string; path: string; old: number; now: number }> {
  const found = await page.evaluate((kind) => {
    for (const card of document.querySelectorAll(".file-card")) {
      for (const row of card.querySelectorAll("tr.diff-line")) {
        const cells = [...row.querySelectorAll("td.diff-gutter")];
        const [left, right] = [cells[0], cells[1]];
        if (left === undefined || right === undefined) continue;
        const pair =
          left.classList.contains("diff-gutter-delete") &&
          right.classList.contains("diff-gutter-insert");
        const context =
          left.classList.contains("diff-gutter-normal") && left.textContent !== right.textContent;
        if (kind === "pair" ? !pair : !context) continue;
        return {
          repo: card.getAttribute("data-repo") ?? "",
          path: card.getAttribute("data-path") ?? "",
          old: Number(left.textContent),
          now: Number(right.textContent),
        };
      }
    }
    return null;
  }, pick);
  if (found === null) throw new Error(`no mounted card has a ${pick} row`);
  return found;
}

/** The row above a thread's widget, the widget's cell, and every thread in that cell. */
function placement(page: Page, id: string) {
  return page.locator(`[data-thread-anchor="${id}"]`).evaluate((element) => {
    const cell = element.closest("td");
    const above = cell?.closest("tr")?.previousElementSibling;
    return {
      gutters: [...(above?.querySelectorAll("td.diff-gutter") ?? [])].map((one) =>
        (one.textContent ?? "").trim(),
      ),
      key: above?.querySelector("td.diff-gutter")?.getAttribute("data-change-key") ?? null,
      row: above?.className ?? "",
      colSpan: cell?.colSpan ?? 0,
      threads: [...(cell?.querySelectorAll("[data-thread-anchor]") ?? [])].map((one) =>
        one.getAttribute("data-thread-anchor"),
      ),
    };
  });
}

test("a thread on the old side sits under the deleted line it names", async ({ page }) => {
  await open(page);
  const at = collision(
    await page.evaluate(async () => (await (await fetch("/api/review")).json()) as Bundle),
  );
  const { id, done } = await written(page, [
    ...["--repo", at.repo, "--path", at.path, "--line", String(at.line)],
    ...["--side", "old", "--severity", "question"],
  ]);
  try {
    await open(page);
    await page.locator(".rail-tabs .tab").nth(1).click();
    await page.locator(`.rail-list [data-thread="${id}"] .thread-focus`).click();
    const widget = page.locator(`[data-thread-anchor="${id}"]`);
    await expect(widget).toBeInViewport();

    // Under the deletion: the row above the widget's is the one the old gutter numbers, and the
    // widget starts in the row's first cell and runs across the whole diff.
    const placed = await widget.evaluate((element) => {
      const cell = element.closest("td");
      const row = cell?.closest("tr");
      const strip = element.closest(".widget-row")?.getBoundingClientRect().width ?? 0;
      const table = element.closest("table")?.getBoundingClientRect().width ?? 1;
      return {
        above: row?.previousElementSibling
          ?.querySelector("td.diff-gutter")
          ?.getAttribute("data-change-key"),
        oldCell: cell?.cellIndex === 0,
        across: strip / table > 0.95,
      };
    });
    expect(placed).toEqual({ above: `D${at.line}`, oldCell: true, across: true });
    // And the bar in the thread's colour is on the old side's gutter, the row's first cell.
    const card = page.locator(`.file-card[data-file="${at.repo}/${at.path}"]`);
    const marked = card.locator(
      `tr.diff-line.marked.question:has(td[data-change-key="D${at.line}"])`,
    );
    await expect(marked).toHaveClass(/\bon-old\b/);
    expect(
      await marked
        .locator("td")
        .first()
        .evaluate((cell) => getComputedStyle(cell).boxShadow),
    ).toContain("inset");

    // The unified view has one column: the widget follows the deleted row, and so does the bar.
    await card.getByRole("button", { name: "unified" }).click();
    await expect(widget).toBeVisible();
    expect(
      await widget.evaluate((element) =>
        element
          .closest("tr")
          ?.previousElementSibling?.querySelector("td.diff-gutter")
          ?.getAttribute("data-change-key"),
      ),
    ).toBe(`D${at.line}`);
    expect(
      await marked
        .locator("td")
        .first()
        .evaluate((cell) => getComputedStyle(cell).boxShadow),
    ).toContain("inset");
  } finally {
    done();
  }
});

test("a split pair with threads on both sides is one strip, the old side's first", async ({
  page,
}) => {
  await open(page);
  const at = await firstRow(page, "pair");
  const where = ["--repo", at.repo, "--path", at.path];
  const old = await written(page, [
    ...where,
    ...["--line", String(at.old), "--side", "old", "--severity", "question"],
  ]);
  const now = await written(page, [
    ...where,
    ...["--line", String(at.now), "--side", "new", "--severity", "critical"],
  ]);
  try {
    await open(page);
    await page.locator(`.file-card[data-file="${at.repo}/${at.path}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-thread-anchor="${now.id}"]`)).toBeVisible();

    const placed = await placement(page, old.id);
    // One cell across the row, the deleted line's thread first (an earlier test's may sit there too,
    // resolved), and a bar on both gutters in the worse colour.
    expect(placed.colSpan).toBe(4);
    expect(placed.threads.filter((one) => one === old.id || one === now.id)).toEqual([
      old.id,
      now.id,
    ]);
    expect(placed.row).toMatch(/\bmarked critical\b/);
    expect(placed.row).toMatch(/\bon-old\b/);
    expect(placed.row).toMatch(/\bon-new\b/);
  } finally {
    old.done();
    now.done();
  }
});

test("a thread on the old side of a context line sits under that row", async ({ page }) => {
  await open(page);
  // A context row whose two numbers differ, so the old one cannot pass for the new.
  const at = await firstRow(page, "context");
  const { id, done } = await written(page, [
    ...["--repo", at.repo, "--path", at.path, "--line", String(at.old)],
    ...["--side", "old", "--severity", "nit"],
  ]);
  try {
    await open(page);
    await page.locator(`.file-card[data-file="${at.repo}/${at.path}"]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-thread-anchor="${id}"]`)).toBeVisible();
    expect(await placement(page, id)).toMatchObject({
      gutters: [String(at.old), String(at.now)],
      colSpan: 4,
    });
  } finally {
    done();
  }
});

test("a thread on the old side of a line `↑ N lines` brought in sits under it", async ({
  page,
}) => {
  await open(page);
  const card = page
    .locator(".file-card")
    .filter({ has: page.locator(".hunk-expand") })
    .first();
  const repo = (await card.getAttribute("data-repo")) ?? "";
  const path = (await card.getAttribute("data-path")) ?? "";
  const header = card.locator(".diff-decoration", { has: page.locator(".hunk-expand") }).first();
  const at = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(
    (await header.locator(".hunk-at").textContent()) ?? "",
  );
  if (at === null) throw new Error("the hunk header names no lines");
  // The line right above the hunk, which only `↑ N lines` puts on the screen.
  const [old, now] = [Number(at[1]) - 1, Number(at[2]) - 1];
  const { id, done } = await written(page, [
    ...["--repo", repo, "--path", path, "--line", String(old)],
    ...["--side", "old", "--severity", "nit"],
  ]);
  try {
    await open(page);
    const again = page.locator(`.file-card[data-file="${repo}/${path}"]`);
    await again.scrollIntoViewIfNeeded();
    await expect(page.locator(`[data-thread-anchor="${id}"]`)).toHaveCount(0);
    await again.locator(".diff-decoration", { hasText: at[0] }).locator(".hunk-expand").click();
    await expect(page.locator(`[data-thread-anchor="${id}"]`)).toBeVisible();
    expect(await placement(page, id)).toMatchObject({
      gutters: [String(old), String(now)],
      colSpan: 4,
    });
  } finally {
    done();
  }
});

test("the bar of a thread on an added file is on its only gutter", async ({ page }) => {
  await open(page);
  const bundle = await page.evaluate(
    async () => (await (await fetch("/api/review")).json()) as Bundle,
  );
  const repo = bundle.repositories.find((one) => one.files.some((f) => f.status === "added"));
  const file = repo?.files.find((one) => one.status === "added");
  if (repo === undefined || file === undefined) throw new Error("the fixture has no added file");
  const { id, done } = await written(page, [
    ...["--repo", repo.path, "--path", file.path, "--line", "1", "--severity", "warning"],
  ]);
  try {
    await open(page);
    await page.locator(".rail-tabs .tab").nth(1).click();
    await page.locator(`.rail-list [data-thread="${id}"] .thread-focus`).click();
    await expect(page.locator(`[data-thread-anchor="${id}"]`)).toBeInViewport();
    // An added file's split table has one side: two cells a row, and the bar on the first.
    const row = page
      .locator(`.file-card[data-file="${repo.path}/${file.path}"] tr.diff-line.marked.warning`)
      .first();
    await expect(row.locator("td")).toHaveCount(2);
    expect(
      await row
        .locator("td")
        .first()
        .evaluate((cell) => getComputedStyle(cell).boxShadow),
    ).toContain("inset");
  } finally {
    done();
  }
});

/** A card the reader collapsed hides the thread's line, not the line's place in the patch: the rail
 * opens the card again rather than taking the reader to browse mode (DA-37.1). */
test("a thread on a collapsed card opens the card, not browse mode", async ({ page }) => {
  await open(page);
  const thread = (await review(page)).comments.find(
    (comment) => comment.repo !== null && comment.path !== null && comment.line !== null,
  );
  if (thread === undefined) throw new Error("the fixture has no line comment");
  const card = page.locator(`.file-card[data-file="${thread.repo}/${thread.path}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.locator(".file-head .caret").click();
  await expect(card.locator(".diff")).toHaveCount(0);

  await page.locator(".rail-tabs .tab").nth(1).click();
  await page.locator(`.rail-list [data-thread="${thread.id}"] .thread-focus`).click();
  await expect(page.locator(`[data-thread-anchor="${thread.id}"]`)).toBeInViewport();
  await expect(card.locator(".file-head .caret")).toHaveAttribute("aria-label", "collapse");
  await expect(page.locator(".plain-card")).toHaveCount(0);
});
