import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The history of review tasks (DA-56): the two groups of the sessions menu, the
 * scope on a row, closing and reopening from the row, and the quiet mark a task
 * somebody else made raises in the header.
 *
 * What reached the disk is read from the data directory, because the point of
 * closing a task is the `status` in `review.json`; the screen is only how it
 * was asked for.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";
const SESSION = "synth";
/** Follows `DIFFALANCHE_DATA_DIR`, the workaround DA-54.1 owns. */
const DATA = join(root, FIXTURE, process.env.DIFFALANCHE_DATA_DIR ?? ".diffalanche");

/**
 * The ceiling this suite holds the mark against: the 300 ms `docs/SPEC.md`
 * section 6 gives a live update, times the allowance a shared runner gets
 * (`RUNNER_ALLOWANCE` in `perf/budgets.ts`), because a strict 300 here on a
 * loaded machine would fail on the machine rather than on the code.
 *
 * **This is the only ceiling the mark has, and it is 2.5× the budget.** The
 * perf gate does not measure it: `BUDGETS` has no line for it, and the nearest
 * one, `updateMs`, times an edit in a repository reaching the card of that file
 * — the `diff-changed` path, which shares nothing with this one but the stream
 * itself. A line for it would mean a metric in `perf/harness.ts` and a row in
 * section 6 of the specification, which is a change to the contract and not
 * this task's to make. The measurement is printed on every run so a regression
 * is at least visible: 246 ms and 234 ms when this was written.
 */
const MARK_CEILING_MS = 750;

function cli(...args: string[]): string {
  return execFileSync("bun", ["run", "src/cli/index.ts", ...args, "--root", FIXTURE], {
    cwd: root,
    encoding: "utf-8",
  });
}

function reviewJson(name: string): { status: string; closedBy: string | null } {
  return JSON.parse(readFileSync(join(DATA, "reviews", name, "review.json"), "utf-8")) as {
    status: string;
    closedBy: string | null;
  };
}

/** What `config.json` signs a write from this server with. */
function configuredUser(): string {
  return (JSON.parse(readFileSync(join(DATA, "config.json"), "utf-8")) as { user: string }).user;
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
}

type Candidates = { repositories: { path: string; files: { path: string }[] }[] };

/**
 * The four tasks the card's verification asks for, all under one prefix: two
 * open — one about the whole root, one about two repositories and five files —
 * and two closed. A fifth, about a single repository, is what the singular of
 * the row's own metric is checked on. Every one is created with `--no-use`, so
 * `current` stays where the fixture put it and this window is the only thing
 * that moves.
 *
 * The prefix is what the assertions filter by. The suites share one fixture and
 * run in one worker, so the sessions the specs before this one made are in the
 * data directory too; counting all the rows would be counting their residue.
 */
async function fourTasks(request: APIRequestContext): Promise<{
  prefix: string;
  plain: string;
  scoped: string;
  /** A task about one repository, read once so its row has a number to print. */
  one: string;
  closed: [string, string];
}> {
  const response = await request.get("/api/sessions/candidates");
  expect(response.ok(), await response.text()).toBe(true);
  const found = ((await response.json()) as Candidates).repositories;
  const first = found.find((one) => one.files.length >= 3);
  const second = found.find((one) => one !== first && one.files.length >= 2);
  if (first === undefined || second === undefined) {
    throw new Error("the fixture has fewer than two repositories with changes");
  }
  const prefix = `hist-${Date.now().toString(36)}`;
  const names = {
    prefix,
    plain: `${prefix}-plain`,
    scoped: `${prefix}-scoped`,
    one: `${prefix}-one`,
    closed: [`${prefix}-closed-a`, `${prefix}-closed-b`] as [string, string],
  };
  const paths = [
    ...first.files.slice(0, 3).map((file) => `${first.path}:${file.path}`),
    ...second.files.slice(0, 2).map((file) => `${second.path}:${file.path}`),
  ];
  cli("review", "new", names.plain, "--base", "head", "--no-use");
  cli(
    "review",
    "new",
    names.scoped,
    "--base",
    "head",
    "--no-use",
    ...paths.flatMap((path) => ["--path", path]),
  );
  for (const name of names.closed) {
    cli("review", "new", name, "--base", "head", "--no-use");
    cli("review", "close", name, "--role", "human", "--author", "kim.p");
  }
  // One repository, and read once: `SessionSummary.repositories` is the length
  // of the task's `diff.json`, which does not exist until something reads the
  // task. Without this read its row would print the dash a task nobody has
  // opened gets, and the singular would have nothing to be checked on.
  cli("review", "new", names.one, "--base", "head", "--no-use", "--repo", first.path);
  expect((await request.get(`/api/review?review=${names.one}`)).ok()).toBe(true);
  return names;
}

/** The rows of one group, by the group's own heading. */
function group(page: Page, label: string) {
  return page.locator(".menu-group").filter({ has: page.locator("h2", { hasText: label }) });
}

test("the menu is two groups, the open tasks above, each row saying what it is about", async ({
  page,
  request,
}) => {
  const names = await fourTasks(request);
  await open(page);
  await page.locator(".pill").first().click();

  const groups = page.locator(".menu-group h2");
  await expect(groups).toHaveCount(2);
  // The open ones first, which is the order of the markup and not of a
  // stylesheet: the reader's eye lands on what is still being worked on.
  await expect(groups).toHaveText(["Открытые задачи", "Закрытые"]);

  const open_ = group(page, "Открытые задачи");
  const closed = group(page, "Закрытые");
  const mine = (where: ReturnType<typeof group>, name: string) =>
    where.locator(".session-row").filter({ has: page.locator(".session-name", { hasText: name }) });

  await expect(mine(open_, names.plain)).toHaveCount(1);
  await expect(mine(open_, names.scoped)).toHaveCount(1);
  for (const name of names.closed) {
    await expect(mine(closed, name)).toHaveCount(1);
    await expect(mine(open_, name)).toHaveCount(0);
  }

  // The split is by status and by nothing else: every row of the lower group
  // carries the chip that says so, and no row of the upper one does.
  const rows = await closed.locator(".session-row").count();
  expect(rows).toBeGreaterThanOrEqual(2);
  expect(await closed.locator(".chip", { hasText: /^CLOSED$/ }).count()).toBe(rows);
  await expect(open_.locator(".chip", { hasText: /^CLOSED$/ })).toHaveCount(0);

  // The scope as it is written — two entries, five paths — and the words a
  // session with no scope gets, which the `SCOPE` pill has no state for.
  await expect(mine(open_, names.scoped).locator(".chip.scope")).toHaveText("2 repos · 5 files");
  await expect(mine(open_, names.plain).locator(".chip.scope")).toHaveText("все репозитории");

  // Both sides of the row inflect, and one of them is a dash. A task about one
  // repository prints `1 repo` beside `1 repo changed`; a task nobody has
  // opened has nothing counted rather than nothing found.
  const single = mine(open_, names.one);
  await expect(single.locator(".chip.scope")).toHaveText("1 repo");
  await expect(single.locator(".session-metrics span").first()).toHaveText("1 repo changed");
  await expect(mine(open_, names.plain).locator(".session-metrics span").first()).toHaveText(
    "— repos changed",
  );

  // The two chips of the row say two different things, and the row this window
  // is on is the one the fixture is current on as well, so both are on it.
  const here = mine(open_, SESSION);
  await expect(here.locator(".chip.here")).toHaveText("ЭТО ОКНО");
  await expect(here.locator(".chip", { hasText: /^CLI$/ })).toHaveCount(1);
  await expect(mine(open_, names.plain).locator(".chip.here")).toHaveCount(0);
});

test("closing the task from its row writes the status, moves the row, and comes back", async ({
  page,
}) => {
  await open(page);
  // Nothing is patched before the stream is up: the frames this press causes
  // have to be able to arrive for their absence below to mean anything.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  await page.locator(".pill").first().click();
  const row = (label: string) =>
    group(page, label)
      .locator(".session-row")
      .filter({ has: page.locator(".session-name", { hasText: SESSION }) });

  try {
    await row("Открытые задачи").getByRole("button", { name: "Close" }).click();

    // What reached the disk, signed by the configured user: the server takes
    // neither the author nor the role from the request (ADR-010, decision 3).
    await expect(page.locator(".toast")).toContainText(`review close ${SESSION}`);
    expect(reviewJson(SESSION).status).toBe("closed");
    expect(reviewJson(SESSION).closedBy).toBe(configuredUser());

    // The row moved between the groups with nothing reloaded, and it kept its
    // counters where it landed.
    await expect(row("Закрытые")).toHaveCount(1);
    await expect(row("Открытые задачи")).toHaveCount(0);
    await expect(row("Закрытые").locator(".session-metrics .crit")).toContainText("open");

    // The ring is where the reader left it: the button they pressed unmounted
    // with its row and was remounted in the other group, and a ring that fell
    // to the document would strand a keyboard reader inside an open popover.
    await expect(row("Закрытые").getByRole("button", { name: "Reopen" })).toBeFocused();

    // **This is the one press that produces two frames.** `SESSION` is the
    // current session, so its new `status` is metadata the watcher compares
    // *and* a status the session snapshot compares: `session-changed` goes out,
    // then `sessions-changed` ([05-watcher.md](../docs/reference/05-watcher.md)).
    // Each is claimed under its own key, so neither raises a mark about the
    // reader's own press — with one key the second frame would.
    await page.waitForTimeout(MARK_CEILING_MS);
    await expect(page.locator(".pill-mark")).toHaveCount(0);

    // The same gesture the other way round.
    await row("Закрытые").getByRole("button", { name: "Reopen" }).click();
    await expect(row("Открытые задачи")).toHaveCount(1);
    expect(reviewJson(SESSION).status).toBe("open");
    await page.waitForTimeout(MARK_CEILING_MS);
    await expect(page.locator(".pill-mark")).toHaveCount(0);
  } finally {
    // A failure half way through may not hand the next spec a closed fixture.
    if (reviewJson(SESSION).status === "closed") {
      cli("review", "reopen", SESSION, "--role", "human", "--author", "kim.p");
    }
  }
});

test("a task made elsewhere raises the mark and moves nothing on the screen", async ({ page }) => {
  await open(page);
  // Nothing is patched before the stream is up, and a mark that was never sent
  // is not a mark that failed to arrive.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  await expect(page.locator(".pill-mark")).toHaveCount(0);

  // A comment being written, and a reading position well down the page: an
  // agent's task appearing may take neither away.
  await page.locator(".file-card").nth(1).getByRole("button", { name: "Comment on file" }).click();
  await page.locator(".composer-field").fill("half a sentence");
  await page.evaluate(() => window.scrollBy(0, 400));
  const before = {
    task: new URL(page.url()).searchParams.get("review"),
    name: await page.locator(".pill-name").first().textContent(),
    scroll: await page.evaluate(() => window.scrollY),
  };

  const name = `agent-${Date.now().toString(36)}`;
  const started = Date.now();
  cli("review", "new", name, "--base", "head", "--no-use");

  await expect(page.locator(".pill-mark")).toBeVisible({ timeout: MARK_CEILING_MS });
  process.stderr.write(`task created to header mark: ${Date.now() - started} ms\n`);

  // The system's status dot and not a round shape of its own: the 7 px status
  // dot is the only circle `DESIGN.md` allows (Shapes), and `.dot.acc` already
  // existed. A second primitive beside it would be a change to the visual
  // contract wearing the clothes of a mark.
  await expect(page.locator(".pill-mark")).toHaveClass(/\bdot\b/);

  // The mark and nothing else: no toast, no switch, no scroll, and the form is
  // where it was with what was typed in it.
  await expect(page.locator(".toast")).toHaveCount(0);
  expect(await page.locator(".pill-name").first().textContent()).toBe(before.name);
  expect(new URL(page.url()).searchParams.get("review")).toBe(before.task);
  expect(await page.evaluate(() => window.scrollY)).toBe(before.scroll);
  await expect(page.locator(".composer-field")).toHaveValue("half a sentence");

  // Opening the history is reading it, so the mark has done its work.
  await page.locator(".pill").first().click();
  await expect(page.locator(".pill-mark")).toHaveCount(0);
  await expect(
    page.locator(".session-row").filter({ has: page.locator(".session-name", { hasText: name }) }),
  ).toHaveCount(1);
});

test("a task this window closes raises no mark of its own", async ({ page, request }) => {
  // A task that is **not** current, so its close is one frame:
  // `sessions-changed` alone, since `session-changed` is about the metadata of
  // the current session and this is not it. A mark here would be a mark about
  // the reader's own press. The two-frame case — closing the current task — is
  // the spec above, which is where the keys have to stay apart.
  const response = await request.post("/api/sessions", {
    data: { name: `own-${Date.now().toString(36)}`, base: "head", use: false },
  });
  expect(response.status(), await response.text()).toBe(201);
  const made = (await response.json()) as { name: string };

  await open(page);
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  await page.locator(".pill").first().click();
  const row = page
    .locator(".session-row")
    .filter({ has: page.locator(".session-name", { hasText: made.name }) });
  await row.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".toast")).toContainText(`review close ${made.name}`);

  // Long enough for the frames the press caused to have arrived: the watcher
  // debounces for 100 ms and walks what it cannot watch every 250.
  await page.waitForTimeout(MARK_CEILING_MS);
  await expect(page.locator(".pill-mark")).toHaveCount(0);

  // And the absence above is the claim working rather than the stream being
  // asleep: a task made outside this window raises the mark on the same page,
  // menu open and all.
  cli("review", "new", `else-${Date.now().toString(36)}`, "--base", "head", "--no-use");
  await expect(page.locator(".pill-mark")).toBeVisible({ timeout: MARK_CEILING_MS });
});
