import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** Live update (DA-25) on a page nobody reloaded: writes from the CLI, edits from the disk, as in
 * the product, where the page is only told ([ADR-005](../docs/adr/adr-005-live-update.md)). */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

/** One diff row; the reading position may not move by more than one of them. */
const ROW_HEIGHT = 22;

type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  status: string;
  role: string;
  body: string;
  replies: { author: string; role: string; body: string }[];
};

type Review = { repositories: { path: string; files: { path: string }[] }[] };

function cli(...args: string[]): string {
  return execFileSync("bun", ["run", "src/cli/index.ts", ...args, "--root", FIXTURE], {
    cwd: root,
    encoding: "utf-8",
  });
}

/** An unanswered line thread after the first: the writing specs reserve that first thread,
 * and another agent reply in an already-awaiting thread cannot increase the awaiting counter. */
function lastThread(): Comment {
  const anchored = comments("open").filter(
    (comment) => comment.repo !== null && comment.path !== null && comment.line !== null,
  );
  if (anchored.length < 2) throw new Error("the fixture has fewer than two open threads on a line");
  const thread = anchored
    .slice(1)
    .filter((comment) => (comment.replies.at(-1)?.role ?? comment.role) === "human")
    .at(-1);
  if (thread === undefined)
    throw new Error(
      "the fixture has no unanswered open line thread after its first anchored thread",
    );
  return thread;
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
  // Nothing is patched before the stream is up, and a test that edited the
  // fixture first would be waiting for a frame that was never sent.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
}

test("the connection footer is above the status bar at scroll zero", async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const bounds = await page.evaluate(() => {
    const foot = document.querySelector(".sidebar-foot")?.getBoundingClientRect();
    const status = document.querySelector(".status-bar")?.getBoundingClientRect();
    if (!foot || !status) throw new Error("footer or status bar missing");
    return {
      scrollY: window.scrollY,
      footTop: foot.top,
      footBottom: foot.bottom,
      statusTop: status.top,
      statusBottom: status.bottom,
    };
  });
  console.log("footer geometry", JSON.stringify(bounds));
  expect(bounds.scrollY).toBe(0);
  expect(bounds.footBottom).toBeLessThanOrEqual(bounds.statusTop);
  await page.screenshot({ path: test.info().outputPath("scroll0.png") });
  await page.locator(".sidebar-foot").focus();
  await expect(page.locator(".sidebar-foot")).toBeFocused();
  const last = page.locator(".tree .file-row").last();
  await page.locator(".tree .file-row").nth(-2).focus();
  await page.keyboard.press("Tab");
  await expect(last).toBeFocused();
  const lastBox = await last.boundingBox();
  expect(lastBox).not.toBeNull();
  expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0)).toBeLessThanOrEqual(bounds.footTop);
  await page.evaluate(() => window.scrollTo(0, 400));
  const scrolled = await page.evaluate(() => ({
    footBottom: document.querySelector(".sidebar-foot")?.getBoundingClientRect().bottom,
    statusTop: document.querySelector(".status-bar")?.getBoundingClientRect().top,
  }));
  expect(scrolled.footBottom).toBeLessThanOrEqual(scrolled.statusTop ?? 0);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const list = document.querySelector(".warnings ul");
    if (!list) throw new Error("warnings missing");
    for (let i = 0; i < 5; i++) {
      const item = document.createElement("li");
      item.textContent = `additional warning ${i}`;
      list.append(item);
    }
  });
  await page.setViewportSize({ width: 1800, height: 1000 });
  await expect
    .poll(async () => {
      const foot = await page.locator(".sidebar-foot").boundingBox();
      const status = await page.locator(".status-bar").boundingBox();
      return Math.round((foot?.y ?? 0) + (foot?.height ?? 0) - (status?.y ?? 0));
    })
    .toBeLessThanOrEqual(0);
  await last.focus();
  const lastAfterResize = await last.boundingBox();
  const footAfterResize = await page.locator(".sidebar-foot").boundingBox();
  expect((lastAfterResize?.y ?? 0) + (lastAfterResize?.height ?? 0)).toBeLessThanOrEqual(
    footAfterResize?.y ?? 0,
  );
  await page.getByRole("button", { name: "light theme" }).click();
  await page.screenshot({ path: test.info().outputPath("wide-light.png") });
  const lightFoot = await page.locator(".sidebar-foot").boundingBox();
  const lightStatus = await page.locator(".status-bar").boundingBox();
  expect((lightFoot?.y ?? 0) + (lightFoot?.height ?? 0)).toBeLessThanOrEqual(lightStatus?.y ?? 0);
});

function review(page: Page): Promise<Review> {
  return page.evaluate(async () => (await (await fetch("/api/review")).json()) as Review);
}

function comments(status: "open" | "all" = "all"): Comment[] {
  return JSON.parse(cli("list", "--json", "--status", status)) as Comment[];
}

test("a reply written from a shell reaches the rail, the counter, and the feed", async ({
  page,
}) => {
  await open(page);
  const thread = lastThread();

  // The tab that spans the review, so the card is listed whichever file the
  // page happens to be reading.
  await page.getByRole("button", { name: /^Review / }).click();
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  await card.waitFor();

  const awaiting = page.locator(".counter", { hasText: "awaiting you" });
  const before = Number((await awaiting.locator("b").textContent()) ?? "0");

  cli(
    "reply",
    thread.id,
    "--body",
    "fixed in the next commit",
    "--author",
    "bob",
    "--role",
    "agent",
  );

  // No reload anywhere in this test: the page is told, it fetches, it patches.
  await expect(card).toContainText("fixed in the next commit");
  await expect(awaiting.locator("b")).toHaveText(String(before + 1));
  await expect(page.locator(".toast")).toContainText("bob");

  await page.getByRole("button", { name: /AGENT ACTIVITY/ }).click();
  await expect(page.locator(".feed-list")).toContainText(`bob replied in ${thread.path}`);
});

test("an agent reply's toast marks the interface text and leaves the author unknown", async ({
  page,
}) => {
  await open(page);
  const thread = lastThread();
  cli(
    "reply",
    thread.id,
    "--body",
    "fixed in the next commit",
    "--author",
    "bob",
    "--role",
    "agent",
  );
  const toast = page.locator(".toast");
  await expect(toast).toContainText("bob");
  await expect(toast.locator('[lang="ru"]')).toHaveText(" ответил · ");
  await expect(toast.locator('[lang=""]').first()).toHaveText("bob");
  const reply = page.locator(`.rail-list [data-thread="${thread.id}"] .reply-body`).last();
  await page.getByRole("button", { name: /^Review / }).click();
  await expect(reply).toHaveText("fixed in the next commit");
  expect(await reply.evaluate((node) => node.closest("[lang]")?.getAttribute("lang"))).toBe("");
});

test("an edit patches its own card, holds the reading position, and leaves the composer open", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  const bundle = await review(page);
  const repository = bundle.repositories.find((one) => one.files.length >= 2);
  if (repository === undefined) throw new Error("the fixture has no repository with two files");
  const edited = `${repository.path}/${repository.files[0]?.path}`;
  const untouched = `${repository.path}/${repository.files[1]?.path}`;

  // The second card across the reading probe, so the edit lands above the reading position; "into
  // view" alone can leave the probe elsewhere (08-ui.md, "A card across the reading probe").
  const placed = await page.locator(`[data-file="${untouched}"]`).evaluate((element) => {
    // `PROBE_Y` of `src/ui/reveal.ts`: below the header and the repository bar.
    const probe = 100;
    element.scrollIntoView();
    window.scrollBy(0, element.getBoundingClientRect().top - (probe - 10));
    const box = element.getBoundingClientRect();
    return box.top < probe && box.bottom > probe;
  });
  if (!placed) throw new Error("the fixture cannot put the second card across the reading probe");
  await page.locator(`[data-file="${untouched}"] .file-body.mounted`).waitFor();

  // A comment being written in the card below the edit: it may not be closed
  // and its text may not be lost.
  await page
    .locator(`[data-file="${untouched}"]`)
    .getByRole("button", { name: "Comment on file" })
    .click();
  await page.locator(".composer-field").fill("half a sentence");
  // The form's suggestions answer the text in the card's own DOM (DA-36): that answer is waited
  // out before the card is watched. The model may load for it — a deadline, not a budget.
  await expect(page.locator(".composer-suggest")).toHaveAttribute(
    "data-state",
    /^(ready|failed)$/,
    {
      timeout: 60_000,
    },
  );

  const marks = await page.evaluate(
    ({ one, two }) => {
      const held = window as unknown as { __mutations: Record<string, number> };
      held.__mutations = { edited: 0, untouched: 0 };
      for (const [key, id] of Object.entries({ edited: one, untouched: two })) {
        const element = document.querySelector(`[data-file="${CSS.escape(id)}"]`);
        if (element === null) continue;
        new MutationObserver((records) => {
          held.__mutations[key] = (held.__mutations[key] ?? 0) + records.length;
        }).observe(element, { childList: true, subtree: true, characterData: true });
      }
      const box = document
        .querySelector(`[data-file="${CSS.escape(two)}"]`)
        ?.getBoundingClientRect();
      return { top: box?.top ?? 0 };
    },
    { one: edited, two: untouched },
  );

  const target = join(root, FIXTURE, edited);
  const original = readFileSync(target, "utf-8");
  const recorded = await page.evaluate(() => window.__perf.settles.length);
  try {
    appendFileSync(target, "\n// an agent added this while the review was open\n");

    await expect(page.locator(`[data-file="${edited}"] .diff-decoration.changed`)).toHaveCount(1);
    await expect(page.locator(`[data-file="${edited}"] .hunk-updated`).first()).toContainText(
      "updated",
    );
    // The patch is painted a few frames before the page corrects the reading position for it, and
    // both assertions below are about the corrected page: its record is what says it is done.
    await page.waitForFunction((before) => window.__perf.settles.length > before, recorded);

    const after = await page.evaluate((id: string) => {
      const held = window as unknown as { __mutations: Record<string, number> };
      const box = document
        .querySelector(`[data-file="${CSS.escape(id)}"]`)
        ?.getBoundingClientRect();
      return { top: box?.top ?? 0, mutations: held.__mutations };
    }, untouched);

    // The card that did not change was not re-rendered at all: its subtree saw
    // no mutation while the card above it was patched.
    expect(after.mutations.edited).toBeGreaterThan(0);
    expect(after.mutations.untouched).toBe(0);
    // The reading position held: what was under the reader is still there.
    expect(Math.abs(after.top - marks.top)).toBeLessThan(ROW_HEIGHT);
    // And the record says the correction was made against the patch and not
    // past it: `grewAfter` counts from the frame the loop stopped on (08-ui.md).
    const settled = await page.evaluate(() => window.__perf.settles.at(-1) ?? null);
    expect(settled).not.toBeNull();
    expect(settled?.corrected).toBe(true);
    expect(settled?.grewAfter).toBe(0);
    // And the form on the other file is where it was, with what was typed in it.
    await expect(page.locator(".composer-field")).toHaveValue("half a sentence");
  } finally {
    writeFileSync(target, original);
    // The restore is an edit the watcher reports a few hundred ms later: wait for the page to take
    // it, or its frame grows a repository in the next spec's stubbed page (DA-25.4).
    await expect(page.locator(`[data-file="${edited}"]`)).not.toContainText(
      "an agent added this while the review was open",
    );
  }
});

/** A stream answered with anything but a stream is closed for good by the browser, with no retry
 * to wait on; the footer says so, and its `reconnect` makes a new one (DA-96.1). */
test("a stream the browser gave up on says disconnected, and reconnect brings it back", async ({
  page,
}) => {
  let refused = true;
  await page.route("**/api/events*", (route) =>
    refused ? route.fulfill({ status: 503, body: "" }) : route.fallback(),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  const foot = page.locator(".sidebar-foot");
  await expect(foot).toContainText("disconnected");
  await expect(foot.locator(".dot")).toHaveClass(/crit/);

  refused = false;
  const reads = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/review");
  // From the keyboard: the ring stays on the footer's line when the button leaves it.
  await foot.getByRole("button", { name: "reconnect" }).focus();
  await page.keyboard.press("Enter");
  await expect(foot).toContainText("watching");
  await expect(foot.getByRole("button", { name: "reconnect" })).toHaveCount(0);
  await expect(foot).toBeFocused();
  // What the page missed while it had no stream is read again, not replayed.
  await reads;
});
