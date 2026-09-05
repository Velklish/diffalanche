import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Live update (DA-25): what an agent's work does to a page nobody reloaded. The
 * writes come from the CLI and the edits from the filesystem, because that is
 * where they come from in the product — the page is only told about them
 * ([ADR-005](../docs/adr/adr-005-live-update.md)).
 */

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

/**
 * The last open thread the fixture carries on a line. The specs share one
 * fixture, and the ones that write into a thread take the first they find, so
 * this one takes the other end of the list: two specs writing into one thread
 * is one of them failing on the other's work.
 */
function lastThread(): Comment {
  const anchored = comments("open").filter(
    (comment) => comment.repo !== null && comment.path !== null && comment.line !== null,
  );
  if (anchored.length < 2) throw new Error("the fixture has fewer than two open threads on a line");
  return anchored.at(-1) as Comment;
}

async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
  // Nothing is patched before the stream is up, and a test that edited the
  // fixture first would be waiting for a frame that was never sent.
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
}

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

test("an edit patches its own card, holds the reading position, and leaves the composer open", async ({
  page,
}) => {
  await open(page);
  const bundle = await review(page);
  const repository = bundle.repositories.find((one) => one.files.length >= 2);
  if (repository === undefined) throw new Error("the fixture has no repository with two files");
  const edited = `${repository.path}/${repository.files[0]?.path}`;
  const untouched = `${repository.path}/${repository.files[1]?.path}`;

  // The second card is put *across* the reading probe — its top just above,
  // its body under it — so the reading position is inside it and the edit lands
  // above that, which is the case the anchoring exists for. Scrolling it "into
  // view" is not enough: a page that cannot scroll any further leaves the probe
  // in the card that grows, or in the warnings bar, and the test would then be
  // measuring something the anchoring does not promise to hold.
  const placed = await page.locator(`[data-file="${untouched}"]`).evaluate((element) => {
    const probe = 62;
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
  try {
    appendFileSync(target, "\n// an agent added this while the review was open\n");

    await expect(page.locator(`[data-file="${edited}"] .diff-decoration.changed`)).toHaveCount(1);
    await expect(page.locator(`[data-file="${edited}"] .hunk-updated`).first()).toContainText(
      "updated",
    );

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
    // And the form on the other file is where it was, with what was typed in it.
    await expect(page.locator(".composer-field")).toHaveValue("half a sentence");
  } finally {
    writeFileSync(target, original);
  }
});
