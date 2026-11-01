import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** The keyboard map and global search of DA-26, row by row of the handoff's table; what a key
 * wrote is read back with the CLI, which proves the file changed and not only the store. */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  status: string;
  body: string;
  severity: string;
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

/** The highlighted hit rests on an `accBd` frame; the ring is `acc`, so focus shows (DA-56.7). */
test("the highlighted search hit changes colour when the keyboard is on it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill("ts");
  const hit = palette(page).locator(".palette-hit.on");
  await expect(hit).toHaveCount(1);
  for (
    let step = 0;
    step < 6 && !(await hit.evaluate((el) => el === document.activeElement));
    step++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(hit).toBeFocused();

  const [ring, frame, acc] = await hit.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--acc)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).outlineColor, getComputedStyle(el).borderTopColor, colour];
  });
  expect(ring).toBe(acc);
  expect(ring).not.toBe(frame);
  await page.keyboard.press("Escape");
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
  if (thread === undefined || thread.path === null)
    throw new Error("the fixture has no open thread on a file line");
  const word = (thread.body.split(/\s+/).find((one) => one.length > 5) ??
    thread.body.trim()) as string;

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("textbox", { name: "search" }).fill(`${word} ${thread.path}`);
  const hit = palette(page).locator(".palette-hit", { hasText: word }).first();
  await expect(hit).toBeVisible();
  await hit.hover();
  // Hovering selects, so the preview follows the pointer without a click.
  await expect(hit).toHaveClass(/on/);
  await expect(palette(page).locator(".palette-path")).toHaveText(thread.path);
  await expect(palette(page).locator(".palette-meta")).toContainText(`L${thread.line}`);
  await expect(palette(page).locator(".palette-line.on")).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
  await expect(page.locator(`.rail-list [data-thread="${thread.id}"]`)).toHaveClass(/on/);
});

test("search opens comment threads at every anchor level", async ({ page, request }) => {
  const bundle = await (await request.get("/api/review")).json();
  const source = bundle.comments.find((one: Comment) => one.repo && one.path && one.line);
  if (!source) throw new Error("the fixture has no line comment");
  const anchors = [
    { id: "search_review", repo: null, path: null, line: null },
    { id: "search_repo", repo: source.repo, path: null, line: null },
    { id: "search_file", repo: source.repo, path: source.path, line: null },
    { id: "search_line", repo: source.repo, path: source.path, line: source.line },
  ];
  bundle.comments = anchors.map((anchor) => ({
    ...source,
    ...anchor,
    endLine: null,
    body: `unique ${anchor.id}`,
    status: "open",
  }));
  await page.route("**/api/review*", (route) => route.fulfill({ json: bundle }));
  await open(page);
  await page.getByRole("button", { name: "unanswered", exact: true }).click();
  await page.keyboard.press("]");
  for (const anchor of anchors) {
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("textbox", { name: "search" }).fill(anchor.id);
    const hit = palette(page).locator(".palette-hit").filter({ hasText: anchor.id });
    await expect(hit).toBeVisible();
    await hit.hover();
    await expect(palette(page).locator(".palette-body-text")).toContainText(anchor.id);
    await hit.click();
    await expect(page.getByRole("button", { name: "unanswered", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator(`.rail-list [data-thread="${anchor.id}"]`)).toHaveClass(/on/);
  }
});

for (const anchor of ["review", "repository"]) {
  test(`search brings the already focused ${anchor} thread back into view`, async ({
    page,
    request,
  }) => {
    const bundle = await (await request.get("/api/review")).json();
    const source = bundle.comments.find((one: Comment) => one.repo && one.path && one.line);
    if (!source) throw new Error("the fixture has no line comment");
    const target = {
      ...source,
      id: "search_again",
      repo: anchor === "review" ? null : source.repo,
      path: null,
      line: null,
      endLine: null,
      status: "resolved",
      body: "unique search_again",
    };
    bundle.comments = [
      target,
      ...Array.from({ length: 40 }, (_, index) => ({
        ...source,
        id: `filler_${index}`,
        body: `filler ${index}`,
      })),
    ];
    await page.route("**/api/review*", (route) => route.fulfill({ json: bundle }));
    await open(page);
    const find = async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("textbox", { name: "search" }).fill("search_again");
      await palette(page).locator(".palette-hit").filter({ hasText: "search_again" }).click();
    };
    const card = page.locator('.rail-list [data-thread="search_again"]');
    await find();
    await expect(card).toBeInViewport();
    await page.locator(".rail-list").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(card).not.toBeInViewport();
    await find();
    await expect(card).toBeInViewport();
    await page.getByRole("button", { name: "unanswered", exact: true }).click();
    await expect(card).toHaveCount(0);
    await find();
    await expect(card).toBeInViewport();
  });
}

test("J walks the open threads and wraps at the end", async ({ page }) => {
  await open(page);
  // Every open thread, review-level ones included: `J` walks those too, and a count without them
  // would stop one short of where it started.
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

/** Opens `New task…`, which needs a repository picked and no scoped task. */
async function newTaskForm(page: Page) {
  await page.getByRole("button", { name: "select" }).click();
  await page.locator(".repo-row").first().click();
  await page.getByRole("button", { name: "New task…" }).click();
  await expect(page.getByRole("dialog", { name: "новая задача" })).toBeVisible();
}

/** One overlay at a time, and one `esc` closes exactly one thing: before the
 * ladder, two hand-written lists of flags both missed the scope surface (DA-70). */
test("esc over an overlay closes it and leaves the draft being written", async ({ page }) => {
  await open(page);
  await page.keyboard.press("c");
  const field = page.locator(".composer-field");
  await field.click();
  await field.type("half a sentence");

  // `New task…` needs no scoped task, which the SCOPE pill would.
  await newTaskForm(page);
  const form = page.getByRole("dialog", { name: "новая задача" });

  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await expect(field).toHaveValue("half a sentence");

  // And the next press is the composer's own.
  await page.keyboard.press("Escape");
  await expect(page.locator(".composer")).toBeHidden();
});

test("an overlay blocks both comment shortcuts until it closes", async ({ page }) => {
  await open(page);
  await page.locator(".file-row").last().click();
  await page.keyboard.press("c");
  const field = page.locator(".composer-field");
  const body = `overlay draft ${Date.now()}`;
  try {
    await field.fill(body);
    await page.getByRole("button", { name: "WARNING", exact: true }).click();
    const anchor = await page.locator(".composer-anchor").textContent();
    const card = page.locator(".file-card").filter({ has: field });
    const repo = await card.getAttribute("data-repo");
    const path = await card.getAttribute("data-path");
    const line = Number(/L(\d+)/.exec(anchor ?? "")?.[1]);
    expect(line).toBeGreaterThan(0);
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/comments")
        writes++;
    });
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette(page)).toBeVisible();
    await page.getByRole("textbox", { name: "search" }).fill("ts");
    await expect(palette(page).locator(".palette-hit").first()).toBeVisible();
    await page.keyboard.press("Meta+Enter");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Control+Enter");
    await expect(palette(page)).toBeVisible();
    await expect(field).toHaveValue(body);
    expect(writes).toBe(0);
    expect(comments().filter((comment) => comment.body === body)).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".composer-anchor")).toHaveText(anchor ?? "");
    await page.keyboard.press("Control+Enter");
    await expect.poll(() => comments().filter((comment) => comment.body === body).length).toBe(1);
    expect(writes).toBe(1);
    expect(comments().find((comment) => comment.body === body)).toMatchObject({
      repo,
      path,
      line,
      severity: "warning",
    });
  } finally {
    for (const comment of comments().filter((one) => one.body === body && one.status === "open")) {
      cli("resolve", comment.id, "--role", "human");
    }
  }
  expect(comments("open").filter((one) => one.body === body)).toHaveLength(0);
});

test("⌘K and ⇧⇧ over an open overlay are refused, not stacked", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "BASE" }).click();
  const picker = page.getByRole("dialog", { name: "base" });
  await expect(picker).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette(page)).toBeHidden();
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
  await expect(palette(page)).toBeHidden();
  // The count is what makes a regression visible: two `Overlay`s mounted would
  // trap the ring in two places and answer one `esc` twice.
  await expect(page.locator(".scrim")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(page.locator(".scrim")).toHaveCount(0);
});

test("a letter under an open overlay belongs to the overlay", async ({ page }) => {
  await open(page);
  await newTaskForm(page);

  // Off the fields first, or the press never reaches the guard: `Create` is the
  // form's only stop that is not one, and an empty name disables it.
  const name = page.getByRole("textbox", { name: "name" });
  await expect(name).toBeFocused();
  await name.fill("ls-probe");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Create" })).toBeFocused();

  await page.keyboard.press("c");
  await expect(page.locator(".composer")).toBeHidden();
  await page.keyboard.press("b");
  await expect(page.locator(".plain-card")).toHaveCount(0);
  // And the letters went nowhere else either.
  await expect(name).toHaveValue("ls-probe");
});

/** The same sentence said twice is two toasts: the second press starts its own
 * 2.2 seconds rather than living out what is left of the first (DA-105). */
test("saying the same thing again gives it the whole lifetime", async ({ page }) => {
  // The page's clock is the test's: on the wall clock a loaded machine could put the second press
  // past the first toast's end, and the verdict would then be about nothing (11-perf.md, "Waits").
  await page.clock.install();
  await open(page);
  // A minute ahead, past the test's own 30 s timeout: a pause at "now + 1 ms" lands in the past
  // whenever the page's clock runs on before the command reaches it.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
  const toast = page.locator(".toast");
  // A press is answered when the clipboard answers, after the click has returned: the clock moves
  // only once the toast has set its 2.2 s timer for that press, and these are counted.
  await page.evaluate(() => {
    const held = window as unknown as { __lifetimes: number };
    const set = window.setTimeout;
    held.__lifetimes = 0;
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (ms === 2_200) held.__lifetimes += 1;
      return set(handler, ms, ...rest);
    }) as typeof window.setTimeout;
  });
  const lifetimes = () =>
    page.evaluate(() => (window as unknown as { __lifetimes: number }).__lifetimes);
  // `Copy .md` says the same sentence on every press; granted, it is the short answer the handoff
  // drew, whose lifetime is the 2.2 s counted here — a refusal is longer and lives longer (DA-102.1).
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Export .md" }).click();
  const copy = page.getByRole("button", { name: "Copy .md" });

  await copy.click();
  await expect(toast).toBeVisible();
  await expect.poll(lifetimes).toBe(1);
  // Late in the first toast's life, and early enough to be sure of it: the
  // lifetime is 2.2 s, so a second press at 1.6 s carries the bar past 2.2 s.
  await page.clock.runFor(1_600);
  await copy.click();
  await expect.poll(lifetimes).toBe(2);

  // Where the first deadline was. Keyed on the text, the toast is gone by now.
  await page.clock.runFor(900);
  await expect(toast).toBeVisible();

  // And it still goes away on its own, 2.2 s after the second press.
  await page.clock.runFor(1_400);
  await expect(toast).toBeHidden();
});

/** A refusal is a sentence written for the CLI, and it stays as long as it takes to read; a short
 * answer keeps the handoff's 2.2 s, which the test above holds (DA-102.1). */
test("a long refusal stays on screen longer than a short answer", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
  // 116 characters, DA-102's storage refusal: 2.2 s and 50 ms for each of the 56 past 60.
  const refusal =
    'comments.json of "synth" cannot be read: comments[3].line is "7a", which is not a whole number'.padEnd(
      116,
      ".",
    );
  await page.route("**/api/sessions/*/base", (route) =>
    route.fulfill({ status: 400, json: { error: "bad-request", message: refusal } }),
  );
  await page.evaluate(() => {
    const held = window as unknown as { __lifetimes: number[] };
    const set = window.setTimeout;
    held.__lifetimes = [];
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if ((ms ?? 0) >= 2_200) held.__lifetimes.push(ms as number);
      return set(handler, ms, ...rest);
    }) as typeof window.setTimeout;
  });
  const lifetimes = () =>
    page.evaluate(() => (window as unknown as { __lifetimes: number[] }).__lifetimes);

  await page.getByRole("button", { name: /BASE/ }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  const toast = page.locator(".toast");
  await expect(toast).toHaveText(refusal);
  await expect.poll(lifetimes).toContain(5_000);

  // Past where 2.2 s would have ended it, and still there; gone once its own 5 s are up.
  await page.clock.runFor(2_300);
  await expect(toast).toBeVisible();
  await page.clock.runFor(2_800);
  await expect(toast).toBeHidden();
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
  // The card turns before the write lands (08-ui.md, "Threads"), so the disk is waited for.
  await expect.poll(() => comments().find((comment) => comment.id === id)?.status).toBe("resolved");
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
