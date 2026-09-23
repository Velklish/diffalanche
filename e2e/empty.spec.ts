import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The empty states of DA-27. The server behind these tests is the one with the
 * fixture in it, so what a root without a session answers is stubbed the way
 * `shell.spec.ts` stubs the review: the screens are the UI's, and what the
 * server says about such a root is `tests/server.test.ts`.
 */

/** What `GET /api/scan` answers before any session exists. */
const SCAN = {
  root: "/root",
  repositories: [
    { path: "repos/a", kind: "repo", branch: "main", hasChanges: true, files: 7 },
    { path: "repos/b", kind: "repo", branch: "main", hasChanges: false, files: 0 },
    { path: "repos/c", kind: "repo", branch: "main", hasChanges: true, files: 2 },
    { path: "repos/a-topic", kind: "worktree", branch: "topic", hasChanges: false, files: 0 },
  ],
  warnings: [],
};

const SESSION = {
  version: 1,
  name: "ls-1",
  title: "",
  base: { mode: "head" },
  createdAt: "2026-09-05T00:00:00Z",
  updatedAt: "2026-09-05T00:00:00Z",
};

/** A session whose base resolves to what the working trees already hold. */
const NO_CHANGES = {
  root: "/root",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
  session: { ...SESSION, name: "ls-ref", base: { mode: "ref", ref: "v0.3.1" } },
  comments: [],
  counters: {
    counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
    repositories: [],
  },
  warnings: [],
};

const REVIEW_AFTER_CREATE = { ...NO_CHANGES, session: SESSION };

async function ready(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true || window.__perf?.files === 0);
}

test("a root with no session shows the first run with the scan's counts", async ({ page }) => {
  await page.route("**/api/review", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "no-current-session", message: "no current review session" },
    }),
  );
  await page.route("**/api/scan", (route) => route.fulfill({ json: SCAN }));
  await page.goto("/");

  const panel = page.getByRole("heading", { name: "Ни одной сессии review" });
  await expect(panel).toBeVisible();
  const metrics = page.locator(".metric-value");
  await expect(metrics).toHaveText(["4", "2", "1"]);
  // The same thing from the terminal, as the handoff's block says.
  await expect(page.locator(".first-run-cli")).toContainText("diffalanche review new");
  // And no review under it: the workspace is not laid out at all.
  await expect(page.locator(".workspace")).toHaveCount(0);
});

test("the metrics are dashes until the scan has answered", async ({ page }) => {
  await page.route("**/api/review", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "no-current-session", message: "no current review session" },
    }),
  );
  // Held open: nothing has been counted yet, and a zero would be a claim.
  let answer: (() => void) | null = null;
  const held = new Promise<void>((done) => {
    answer = done;
  });
  await page.route("**/api/scan", async (route) => {
    await held;
    await route.fulfill({ json: SCAN });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Ни одной сессии review" })).toBeVisible();
  await expect(page.locator(".metric-value")).toHaveText(["—", "—", "—"]);

  (answer as unknown as () => void)();
  await expect(page.locator(".metric-value")).toHaveText(["4", "2", "1"]);
});

test("creating a session there opens the review", async ({ page }) => {
  let created = false;
  await page.route("**/api/review", (route) =>
    created
      ? route.fulfill({ json: REVIEW_AFTER_CREATE })
      : route.fulfill({
          status: 404,
          json: { error: "no-current-session", message: "no current review session" },
        }),
  );
  await page.route("**/api/scan", (route) => route.fulfill({ json: SCAN }));
  await page.route("**/api/sessions", (route) => {
    created = true;
    return route.fulfill({ status: 201, json: SESSION });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ни одной сессии review" })).toBeVisible();

  await page.getByRole("textbox", { name: "session name" }).fill("ls-1");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".pill-name").first()).toHaveText("ls-1");
});

test("a session with an empty change set shows the no-changes screen", async ({ page }) => {
  await page.route("**/api/review", (route) => route.fulfill({ json: NO_CHANGES }));
  await ready(page);

  await expect(page.getByRole("heading", { name: "Изменений нет" })).toBeVisible();
  await expect(page.locator(".no-changes-note")).toContainText("ls-ref");
  await expect(page.getByRole("button", { name: "Change base" })).toBeVisible();

  // The other way out is the sessions menu, which opens from here as it does
  // from the header's pill.
  await page.getByRole("button", { name: "Other session" }).click();
  await expect(page.getByRole("region", { name: "review sessions" })).toBeVisible();
});

/** `Change base` rests on an `accBd` border; the ring is `acc` and has to outrank it (DA-56.7). */
test("the accent button of the no-changes screen changes colour under the keyboard", async ({
  page,
}) => {
  await page.route("**/api/review", (route) => route.fulfill({ json: NO_CHANGES }));
  await ready(page);
  const button = page.getByRole("button", { name: "Change base" });
  const rest = await button.evaluate((el) => getComputedStyle(el).borderTopColor);
  for (
    let step = 0;
    step < 30 && !(await button.evaluate((el) => el === document.activeElement));
    step++
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();

  const [ring, acc] = await button.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--acc)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).borderTopColor, colour];
  });
  expect(ring).toBe(acc);
  expect(ring).not.toBe(rest);
});

/** The live path of DA-100.2: the base that brings changes takes this screen, and `Change base`
 * with it, away; the restore waited for that and hands the ring to the `BASE` pill. */
test("a base that brings changes leaves the ring on the BASE pill", async ({ page, request }) => {
  const changed = (await (await request.get("/api/review")).json()) as typeof NO_CHANGES;
  const empty = { ...changed, repositories: [], comments: [], counters: NO_CHANGES.counters };
  let applied = false;
  await page.route("**/api/review*", (route) => route.fulfill({ json: applied ? changed : empty }));
  await page.route("**/api/sessions/*/base", (route) => {
    applied = true;
    return route.fulfill({ json: changed.session });
  });
  await ready(page);

  await page.getByRole("button", { name: "Change base" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".file-card").first()).toBeVisible();

  await expect(page.locator(".pill.base")).toBeFocused();
});

/** The restore is owed only to a ring that is nowhere (DA-100.2): one the reader put on the
 * header while the review was held back is not taken from them. */
test("a ring moved while the base is being applied stays where it was put", async ({
  page,
  request,
}) => {
  const changed = (await (await request.get("/api/review")).json()) as typeof NO_CHANGES;
  const empty = { ...changed, repositories: [], comments: [], counters: NO_CHANGES.counters };
  let applied = false;
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/api/review*", async (route) => {
    if (!applied) return route.fulfill({ json: empty });
    await held;
    return route.fulfill({ json: changed });
  });
  await page.route("**/api/sessions/*/base", (route) => {
    applied = true;
    return route.fulfill({ json: changed.session });
  });
  await ready(page);

  await page.getByRole("button", { name: "Change base" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("dialog", { name: "base" })).toHaveCount(0);
  // Exact: a repository row named `…/loads-search` arrives with the review.
  const search = page.getByRole("button", { name: "search", exact: true });
  await search.focus();
  release();
  await expect(page.locator(".toast")).toContainText("База сессии");
  // Two macrotasks: the restore is queued one after the switch clears, and this after it.
  await page.evaluate(() => new Promise((done) => setTimeout(() => setTimeout(done, 0), 0)));

  await expect(search).toBeFocused();
});
