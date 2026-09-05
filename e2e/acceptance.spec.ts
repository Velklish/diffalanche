import { execFileSync } from "node:child_process";
import { devNull } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { BINARY, FIXTURE, ROOT, SESSION } from "./binary.ts";
import {
  FEATURE_BRANCH,
  FEATURE_FILE,
  FEATURE_LINE,
  FEATURE_REPO,
  NESTED_WORKTREE,
} from "./fixture.ts";

/**
 * The acceptance list of `docs/SPEC.md` section 10, one named test per line of
 * it, run against the binary of the runner's platform over the fixture
 * `e2e/fixture.ts` builds (`e2e/acceptance.config.ts`). The server is that
 * binary and so is every `diffalanche` the tests shell out to: what is checked
 * here is the artefact that ships, not the sources it was built from.
 *
 * The tests are thin on purpose. Each one asserts the sentence of section 10
 * and nothing more; the behaviour behind a sentence is covered in depth by the
 * spec that owns that screen — `sidebar.spec.ts`, `composer.spec.ts`,
 * `threads.spec.ts`, `live.spec.ts`, `header.spec.ts` — which run against the
 * dev server on the fast path of `bun run test:ui`. The table in
 * `docs/reference/08-ui.md` names both for every criterion.
 */

/** The binary, over the acceptance fixture, as an agent would call it. */
function cli(...args: string[]): string {
  return execFileSync(BINARY, [...args, "--root", FIXTURE], { cwd: ROOT, encoding: "utf-8" });
}

/**
 * Git in the fixture, read-only and with the developer's own configuration out
 * of the way, so a `status.showUntrackedFiles` in a global config cannot change
 * what a test sees.
 */
function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", join(ROOT, FIXTURE, repo), ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
    encoding: "utf-8",
  });
}

type Scanned = { path: string; kind: string; branch: string; hasChanges: boolean };
type Scan = { repositories: Scanned[] };
type File = { path: string; status: string; additions: number; deletions: number };
type Review = { repositories: { path: string; files: File[] }[] };
type Comment = {
  id: string;
  repo: string | null;
  path: string | null;
  line: number | null;
  replies: { author: string; role: string; body: string }[];
};

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card").first().waitFor();
  // And then for the stream, which is a second effect and not part of loading
  // the review: `reply-added`, `comment-status` and `session-changed` are
  // pushed and never asked for again, so a CLI write that lands between the
  // first card and `onopen` reaches nobody and is lost for good. Waiting for
  // the footer is what `live.spec.ts` does, for the same reason.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
}

function scan(page: Page): Promise<Scan> {
  return page.evaluate(async () => (await (await fetch("/api/scan")).json()) as Scan);
}

function review(page: Page): Promise<Review> {
  return page.evaluate(async () => (await (await fetch("/api/review")).json()) as Review);
}

function comments(status: "open" | "all" = "all"): Comment[] {
  return JSON.parse(cli("list", "--json", "--status", status)) as Comment[];
}

/**
 * Puts the fixture back on the session and the base the rest of the file
 * expects, whatever the test that just ran did with them. Through the API, and
 * not the CLI, for the reason `header.spec.ts` gives: the server holds the
 * review document until one of its own write routes drops it, and a CLI write
 * is only noticed once the watcher gets round to it.
 */
test.afterEach(async ({ request }) => {
  const used = await request.post(`/api/sessions/${SESSION}/use`, { data: {} });
  expect(used.ok(), await used.text()).toBe(true);
  const based = await request.put(`/api/sessions/${SESSION}/base`, { data: { base: "head" } });
  expect(based.ok(), await based.text()).toBe(true);
});

// ---------------------------------------------------------------------------
// What a scan finds
// ---------------------------------------------------------------------------

test("serve lists every repository with changes", async ({ page }) => {
  await open(page);
  const found = await scan(page);
  const withChanges = found.repositories
    .filter((repository) => repository.hasChanges)
    .map((repository) => repository.path);
  expect(withChanges.length).toBeGreaterThan(0);

  expect(await page.locator(".repo-row .repo-name").allTextContents()).toEqual(withChanges);
});

test("a worktree checked out as a sibling directory is its own repository", async ({ page }) => {
  await open(page);
  const found = await scan(page);

  const worktree = found.repositories.find((repository) => repository.kind === "worktree");
  expect(worktree, "the fixture has no sibling worktree").toBeDefined();
  // Its own entry, at its own path, and not a directory inside the repository
  // it was checked out from.
  expect(worktree?.path).not.toContain("/.git");
  expect(found.repositories.filter((one) => one.path === worktree?.path)).toHaveLength(1);
  expect(git(worktree?.path ?? "", "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(
    worktree?.branch,
  );
});

test("a submodule or worktree nested inside a repository is not listed", async ({ page }) => {
  await open(page);
  const found = await scan(page);

  // Both halves of the sentence. The generator puts a submodule at `vendor/lib`
  // of the first repository, and the fixture puts a worktree inside the one
  // with the remote; each is a git working tree of its own, and no scan may
  // offer either as a repository.
  const host = found.repositories.find((repository) => repository.kind === "repo");
  expect(host).toBeDefined();
  const listed = found.repositories.map((repository) => repository.path);
  const nestings = [
    { holder: host?.path ?? "", nested: `${host?.path}/vendor/lib` },
    { holder: FEATURE_REPO, nested: NESTED_WORKTREE },
  ];
  for (const { holder, nested } of nestings) {
    expect(git(nested, "rev-parse", "--is-inside-work-tree").trim()).toBe("true");
    expect(listed).not.toContain(nested);
    // Nor anything else inside the repository that holds it, under any name:
    // what section 10 forbids is descending, not one path.
    expect(listed.filter((path) => path.startsWith(`${holder}/`))).toEqual([]);
  }
});

// ---------------------------------------------------------------------------
// What the diff carries, and what a scan leaves behind
// ---------------------------------------------------------------------------

test("an untracked file is in the diff", async ({ page }) => {
  await open(page);
  const bundle = await review(page);

  const repository = bundle.repositories.find((one) =>
    git(one.path, "status", "--porcelain", "--untracked-files=all")
      .split("\n")
      .some((row) => row.startsWith("?? ")),
  );
  expect(repository, "the fixture has no untracked file").toBeDefined();
  const untracked = git(repository?.path ?? "", "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter((row) => row.startsWith("?? "))
    .map((row) => row.slice(3));

  const shown = repository?.files.find((file) => untracked.includes(file.path));
  expect(shown, `none of ${untracked.join(", ")} is in the change set`).toBeDefined();
  // A file git does not track has no old side: every line of it is an addition.
  expect(shown?.status).toBe("added");
  expect(shown?.deletions).toBe(0);

  const card = page.locator(`[data-file="${repository?.path}/${shown?.path}"]`);
  await expect(card.locator(".add")).toHaveText(`+${shown?.additions}`);
  await expect(card.locator(".del")).toHaveText("−0");
});

test("a scan leaves git status as it found it", async ({ page }) => {
  const paths = (JSON.parse(cli("diff", "--json")) as { repositories: { path: string }[] })
    .repositories;
  expect(paths.length).toBeGreaterThan(0);
  const before = paths.map((one) =>
    git(one.path, "status", "--porcelain", "--untracked-files=all"),
  );

  await open(page);
  // Not the cached document: `/api/scan` walks the root and reads every
  // repository again, which is the scan the criterion is about.
  await scan(page);

  const after = paths.map((one) => git(one.path, "status", "--porcelain", "--untracked-files=all"));
  expect(after).toEqual(before);
});

// ---------------------------------------------------------------------------
// The base
// ---------------------------------------------------------------------------

test("branch mode shows what a feature branch committed ahead of the remote default branch", async ({
  page,
}) => {
  await open(page);
  // The precondition of the criterion: commits ahead, and nothing uncommitted.
  expect(git(FEATURE_REPO, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(FEATURE_BRANCH);
  expect(git(FEATURE_REPO, "status", "--porcelain")).toBe("");
  // So in `head` mode it has nothing to show, and it is not in the review.
  await expect(page.locator(`[data-repo-section="${FEATURE_REPO}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: /BASE/ }).click();
  await page.getByRole("button", { name: /^branch/ }).click();
  // The picker's first row, the one that names no branch: `branch` mode then
  // reads each repository's own remote default branch, which is the criterion.
  // The row whose *name* is "default branch", exactly: `origin/main` is listed
  // below it and its note reads "default branch · 1 repos", so anything looser
  // than an exact match on the name finds both.
  await page
    .locator(".picker-branch")
    .filter({ has: page.getByText("default branch", { exact: true }) })
    .click();
  await page.getByRole("button", { name: "Apply" }).click();

  const section = page.locator(`[data-repo-section="${FEATURE_REPO}"]`);
  await expect(section).toHaveCount(1);
  await expect(section.locator(".repo-base")).toContainText("origin/main");
  await expect(section.locator(".repo-base")).toContainText("merge-base");
  const card = section.locator(`[data-path="${FEATURE_FILE}"]`);
  await expect(card.locator(".file-path")).toHaveText(FEATURE_FILE);
  // The line the branch is ahead by, in the diff and not only in the header:
  // "shows the committed changes" is about what is on the screen.
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".diff")).toContainText(FEATURE_LINE);
});

// ---------------------------------------------------------------------------
// The comment round trip
// ---------------------------------------------------------------------------

test("a comment written in the UI is in list --json without a restart", async ({ page }) => {
  await open(page);
  const before = new Set(comments().map((comment) => comment.id));
  const card = page.locator(".file-card").first();
  const path = await card.getAttribute("data-path");

  await card.getByRole("button", { name: "Comment on file" }).click();
  const composer = card.locator('[data-testid="file-composer"]');
  await composer.locator(".composer-field").fill("the acceptance list wrote this");
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(page.locator(".toast")).toBeVisible();

  // The same server process is still running: nothing was restarted between
  // the write in the browser and this read.
  const written = comments().filter((comment) => !before.has(comment.id));
  expect(written).toHaveLength(1);
  expect(written[0]).toMatchObject({ path, body: "the acceptance list wrote this" });
});

test("a reply made with reply is in the UI without a refresh", async ({ page }) => {
  await open(page);
  const thread = anchored();

  await page.getByRole("button", { name: /^Review / }).click();
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  await card.waitFor();

  cli(
    "reply",
    thread.id,
    "--body",
    "answered from a shell",
    "--author",
    "nadia",
    "--role",
    "agent",
  );

  // No reload and no navigation between the write and this assertion.
  await expect(card).toContainText("answered from a shell");
});

test("resolve in the UI takes the comment out of list --status open", async ({ page }) => {
  await open(page);
  const thread = anchored();

  await page.getByRole("button", { name: /^Review / }).click();
  const card = page.locator(`.rail-list [data-thread="${thread.id}"]`);
  await card.waitFor();
  expect(comments("open").some((comment) => comment.id === thread.id)).toBe(true);

  await card.getByRole("button", { name: "Resolve" }).click();
  await expect(card).toHaveClass(/resolved/);

  await expect.poll(() => comments("open").some((comment) => comment.id === thread.id)).toBe(false);
});

test("a reply made with reply is in the activity feed under the agent's --author", async ({
  page,
}) => {
  await open(page);
  const thread = anchored();

  cli("reply", thread.id, "--body", "and again", "--author", "pavel", "--role", "agent");

  await page.getByRole("button", { name: /AGENT ACTIVITY/ }).click();
  await expect(page.locator(".feed-list")).toContainText(`pavel replied in ${thread.path}`);
});

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

test("review use switches the UI and the CLI at once", async ({ page }) => {
  await open(page);
  const other = `acc-${Date.now().toString(36)}`;
  cli("review", "new", other, "--base", "head");
  // `review new` makes what it created current, so the page is already on the
  // other session; going back is the switch this test watches.
  await expect(page.locator(".pill-name").first()).toHaveText(other);

  cli("review", "use", SESSION);

  // The UI, without a reload …
  await expect(page.locator(".pill-name").first()).toHaveText(SESSION);
  // … and the CLI, without `--review`: the comments it answers with are this
  // session's, and the other one has none.
  expect(comments().length).toBeGreaterThan(0);
  expect(JSON.parse(cli("list", "--json", "--review", other)) as Comment[]).toHaveLength(0);
});

/**
 * A thread on a line, taken from the end of the list. The tests here share one
 * fixture and one server, and two of them write into a thread; taking the last
 * one leaves the front of the list to whoever comes looking for the first.
 */
function anchored(): Comment {
  const threads = comments("open").filter(
    (comment) => comment.repo !== null && comment.path !== null && comment.line !== null,
  );
  if (threads.length < 2) throw new Error("the fixture has fewer than two open threads on a line");
  return threads.at(-1) as Comment;
}
