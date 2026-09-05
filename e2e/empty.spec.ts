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
