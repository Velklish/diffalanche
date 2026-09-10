import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * The scope on the screen (DA-55): the `SCOPE` pill, the editor over the whole
 * root, the one confirmation that destroys review data, select mode, and the
 * `?review=` that decides what a window is on.
 *
 * What reached the disk is read from the data directory rather than from the
 * page: the point of every one of these is what was written, and the screen is
 * only how it was asked for.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";
const SESSION = "synth";
/**
 * Where the fixture's data directory is. It follows `DIFFALANCHE_DATA_DIR`,
 * which this suite needs on a machine whose user configuration sets a relative
 * `dataDir` — the workaround DA-54.1 owns.
 */
const DATA = join(root, FIXTURE, process.env.DIFFALANCHE_DATA_DIR ?? ".diffalanche");

/**
 * Exactly this path and not one it is a prefix of. The fixture holds both
 * `repos/core/cargos-api` and `repos/core/cargos-api-worktree`, and
 * Playwright's `hasText` is a substring match: a filter written with the bare
 * path would take two rows the moment the worktree had changes, and strict mode
 * would fail on a collision rather than on a defect.
 */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

function cli(...args: string[]): string {
  return execFileSync("bun", ["run", "src/cli/index.ts", ...args, "--root", FIXTURE], {
    cwd: root,
    encoding: "utf-8",
  });
}

function reviewJson(name: string): { scope: unknown; status: string } {
  return JSON.parse(readFileSync(join(DATA, "reviews", name, "review.json"), "utf-8")) as {
    scope: unknown;
    status: string;
  };
}

function commentsFile(name: string): Buffer {
  return readFileSync(join(DATA, "reviews", name, "comments.json"));
}

/** What `current` names. Nothing this window does may move it (ADR-010, decision 7). */
function currentPointer(): string {
  return readFileSync(join(DATA, "current"), "utf-8");
}

async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.waitForFunction(() => window.__perf?.ready === true);
}

type Candidates = { repositories: { path: string; files: { path: string }[] }[] };

/** The whole root, which is what the editor picks from and this suite builds from. */
async function candidates(request: APIRequestContext): Promise<Candidates["repositories"]> {
  const response = await request.get("/api/sessions/candidates");
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as Candidates).repositories;
}

type Task = {
  name: string;
  /** The repository three of whose files the task is about. */
  first: { path: string; files: string[] };
  /** The repository two of whose files it is about. */
  second: { path: string; files: string[] };
  /** The repository of the fixture the task is not about at all. */
  left: string;
};

/**
 * A task about **two repositories and five files** — the shape the card's
 * verification names — built through the CLI with `--no-use`, so `current` is
 * where it was and this window is the only thing that moves.
 */
async function scopedTask(request: APIRequestContext): Promise<Task> {
  const found = await candidates(request);
  const first = found.find((one) => one.files.length >= 3);
  const second = found.find((one) => one !== first && one.files.length >= 2);
  const left = found.find((one) => one !== first && one !== second);
  if (first === undefined || second === undefined || left === undefined) {
    throw new Error("the fixture has fewer than three repositories with changes");
  }
  const task: Task = {
    name: `scope-${Date.now().toString(36)}`,
    first: { path: first.path, files: first.files.slice(0, 3).map((file) => file.path) },
    second: { path: second.path, files: second.files.slice(0, 2).map((file) => file.path) },
    left: left.path,
  };
  const paths = [
    ...task.first.files.map((file) => `${task.first.path}:${file}`),
    ...task.second.files.map((file) => `${task.second.path}:${file}`),
  ];
  cli(
    "review",
    "new",
    task.name,
    "--base",
    "head",
    "--no-use",
    ...paths.flatMap((p) => ["--path", p]),
  );
  return task;
}

test("a task carries its scope and nothing else, and the pill counts it", async ({
  page,
  request,
}) => {
  const task = await scopedTask(request);
  await open(page, `/?review=${task.name}`);

  await expect(page.locator(".file-card")).toHaveCount(5);
  await expect(page.locator(".file-row")).toHaveCount(5);
  await expect(page.locator(".repo-row")).toHaveCount(2);
  await expect(page.locator(".pill.scope .pill-name")).toHaveText("2 repos · 5 files");

  // Nothing outside the scope is *shown* — no summary, no collapsed section, no
  // count of what was left out (ADR-010, decision 2). The repository the task
  // is not about is absent from the markup of the review, not hidden by a
  // stylesheet. The workspace and not the whole page: the scanner's warnings
  // bar names a worktree of the root, which is a warning about the scan rather
  // than a repository the review is showing.
  expect(await page.locator(".workspace").innerHTML()).not.toContain(task.left);
});

test("a session with no scope has no pill at all", async ({ page }) => {
  await open(page);
  await expect(page.locator(".pill-name").first()).toHaveText(SESSION);
  await expect(page.locator(".pill.scope")).toHaveCount(0);
});

test("a task the data directory has not names itself and offers a way back", async ({ page }) => {
  // The one address a person types and pastes by hand, so the one failure most
  // likely to be a typo. `open()` is not used: the page never reports ready,
  // because there is no review to show.
  await page.goto("/?review=nope-nope");
  await expect(page.locator(".no-changes-title")).toContainText("nope-nope");
  await expect(page.locator(".failure")).toContainText("nope-nope");

  await page.getByRole("button", { name: "Текущая сессия" }).click();
  await expect(page.locator(".pill-name").first()).toHaveText(SESSION);
  expect(new URL(page.url()).searchParams.get("review")).toBeNull();
});

test("the editor lists the whole root while the tree lists the task", async ({ page, request }) => {
  const task = await scopedTask(request);
  await open(page, `/?review=${task.name}`);
  await expect(page.locator(".repo-row")).toHaveCount(2);

  await page.locator(".pill.scope").click();
  // A scope cannot be widened from a tree that already hides what is missing,
  // so the editor is the one surface that offers the whole root.
  await expect(page.locator(".scope-repo")).toHaveCount(3);
  await expect(
    page.locator(".scope-repo .repo-name").filter({ hasText: exactly(task.left) }),
  ).toHaveCount(1);
  await expect(page.locator(".overlay.scope .picker-summary")).toHaveText("2 repos · 5 files");
});

test("taking a file out of the scope asks before it deletes the comments under it", async ({
  page,
  request,
}) => {
  const task = await scopedTask(request);
  const path = task.first.files[0] as string;
  // The window reads the task before anybody comments in it, and that read is
  // what writes its change set.
  expect((await request.get(`/api/review?review=${task.name}`)).ok()).toBe(true);
  const written = await request.post(`/api/comments?review=${task.name}`, {
    data: { repo: task.first.path, path, severity: "warning", body: "a finding on this file" },
  });
  expect(written.status(), await written.text()).toBe(201);

  await open(page, `/?review=${task.name}`);
  await page.locator(".pill.scope").click();
  const file = page
    .locator(".scope-repo")
    .filter({ has: page.locator(".repo-name", { hasText: exactly(task.first.path) }) })
    .locator(".scope-file")
    .filter({ has: page.locator(".file-name", { hasText: exactly(path) }) });
  await file.click();
  await page.locator(".overlay.scope").getByRole("button", { name: "Apply" }).click();

  // The count is the server's own 409, and how many of them are open is read
  // from the threads this page is holding.
  const question = page.locator(".confirm-question");
  await expect(question).toContainText(path);
  await expect(question).toContainText("1 комментарий (1 открыт)");

  // One overlay at a time: `esc` answers the confirmation and gives the editor
  // back with the draft it had, rather than taking both away — `Overlay`
  // listens for `esc` on the document, so two of them would answer one press.
  await page.keyboard.press("Escape");
  await expect(page.locator(".confirm-question")).toHaveCount(0);
  await expect(page.locator(".overlay.scope")).toHaveCount(1);
  await expect(page.locator(".overlay.scope .picker-summary")).toHaveText("2 repos · 4 files");

  // And the ring is inside the one dialog that destroys review data: the first
  // `Tab` lands on its own first control and not on the page behind it.
  await page.locator(".overlay.scope").getByRole("button", { name: "Apply" }).click();
  await expect(question).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Отмена" })).toBeFocused();

  // Cancelling writes nothing at all: the refusal that raised the question
  // wrote nothing either.
  const before = commentsFile(task.name);
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(page.locator(".confirm-question")).toHaveCount(0);
  expect(commentsFile(task.name).equals(before)).toBe(true);
  expect(reviewJson(task.name).scope).toEqual([
    { repo: task.first.path, paths: task.first.files },
    { repo: task.second.path, paths: task.second.files },
  ]);

  // Confirming takes the file and its comment together, in one write.
  await page.locator(".overlay.scope").getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Убрать и удалить" }).click();
  await expect(page.locator(".file-row")).toHaveCount(4);
  await expect(page.locator(".pill.scope .pill-name")).toHaveText("2 repos · 4 files");
  expect(JSON.parse(cli("list", "--json", "--status", "all", "--review", task.name))).toEqual([]);
  expect(reviewJson(task.name).scope).toEqual([
    { repo: task.first.path, paths: [...task.first.files.slice(1)].sort() },
    { repo: task.second.path, paths: [...task.second.files].sort() },
  ]);
});

test("select mode builds a task out of the tree and leaves it as it was", async ({
  page,
  request,
}) => {
  const found = await candidates(request);
  const whole = found[0] as { path: string; files: { path: string }[] };
  const partly = found.find((one) => one !== whole && one.files.length >= 3);
  if (partly === undefined)
    throw new Error("the fixture has no second repository with three files");
  const picked = partly.files.slice(0, 3).map((file) => file.path);

  await open(page);
  await page.getByRole("button", { name: "select" }).click();
  await page
    .locator(".repo-row")
    .filter({ has: page.locator(".repo-name", { hasText: exactly(whole.path) }) })
    .click();
  const branch = page
    .locator(".branch")
    .filter({ has: page.locator(".repo-name", { hasText: exactly(partly.path) }) });
  for (const path of picked) {
    await branch
      .locator(".file-row")
      .filter({ has: page.locator(".file-name", { hasText: exactly(path) }) })
      .click();
  }
  await expect(page.locator(".select-count")).toHaveText("2 repos · 3 files");

  const name = `sel-${Date.now().toString(36)}`;
  const pointer = currentPointer();
  await page.getByRole("button", { name: "New task…" }).click();
  await page.getByRole("textbox", { name: "name" }).fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".pill-name").first()).toHaveText(name);

  // Exactly what was ticked: the repository as a whole, and the three files.
  expect(reviewJson(name).scope).toEqual(
    [
      { repo: whole.path, paths: null },
      { repo: partly.path, paths: [...picked].sort() },
    ].sort((a, b) => (a.repo < b.repo ? -1 : 1)),
  );
  // Creating a task does not move `current` (ADR-010, decision 4).
  expect(currentPointer()).toBe(pointer);

  // Outside the mode the tree is exactly what it was: no ticks anywhere.
  await page.getByRole("button", { name: "changes" }).click();
  await expect(page.locator(".tick")).toHaveCount(0);
});

test("two windows, two tasks, and a pointer neither of them moves", async ({
  page,
  context,
  request,
}) => {
  const task = await scopedTask(request);
  const pointer = currentPointer();

  await open(page);
  await expect(page.locator(".pill-name").first()).toHaveText(SESSION);

  const second = await context.newPage();
  await open(second, `/?review=${task.name}`);
  await expect(second.locator(".pill-name").first()).toHaveText(task.name);

  // The first window keeps its own task while the second reads another.
  await expect(page.locator(".pill-name").first()).toHaveText(SESSION);
  expect(currentPointer()).toBe(pointer);
  await second.close();
});
