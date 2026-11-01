/** DA-152's original ordering gaps over actual CLI writes and server streams. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

function cli(...args: string[]): string {
  return execFileSync("bun", ["run", "src/cli/index.ts", ...args, "--root", FIXTURE], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function finding(name: string, body: string): string {
  return cli("comment", "--review", name, "--severity", "nit", "--body", body).split(" ")[0] ?? "";
}

function gate() {
  let release = () => {};
  const pending = new Promise<void>((done) => {
    release = done;
  });
  return { pending, release };
}

/** A second connection confirms that the write's burst ended before the tested gap closes. */
async function observe(page: Page, name: string) {
  await page.goto(`/?review=${name}`);
  await expect(page.locator(".pill-name").first()).toHaveText(name);
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  await page.evaluate(
    (task) =>
      new Promise<void>((opened) => {
        const heard: string[] = [];
        (window as unknown as { __handoverHeard: string[] }).__handoverHeard = heard;
        const source = new EventSource(`/api/events?review=${encodeURIComponent(task)}`);
        source.addEventListener("comment-added", (frame) => {
          heard.push((JSON.parse((frame as MessageEvent<string>).data) as { id: string }).id);
        });
        source.onopen = () => opened();
      }),
    name,
  );
}

async function heard(page: Page, id: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          (comment) =>
            (window as unknown as { __handoverHeard: string[] }).__handoverHeard.includes(comment),
          id,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function once(page: Page, name: string, id: string, body: string) {
  await expect(page.locator(".pill-name").first()).toHaveText(name);
  await page.getByRole("button", { name: /^Review / }).click();
  const thread = page.locator(`.rail-list [data-thread="${id}"]`);
  await expect(thread).toHaveCount(1, { timeout: 20_000 });
  await expect(thread).toContainText(body);
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  await expect(page.locator(".failure")).toHaveCount(0);
}

async function capture(page: Page, info: TestInfo, label: string) {
  await page.screenshot({ path: info.outputPath(`${label}.png`), fullPage: true });
}

test("55.10: current's served document precedes a write and the new window's subscription", async ({
  page,
  context,
}, info) => {
  const observer = await context.newPage();
  await observe(observer, "synth");
  const streams = gate();
  const captured = gate();
  const trace: string[] = [];
  let oldBody = "";
  let requests = 0;
  let opened = false;
  await page.route("**/api/review", async (route) => {
    const number = ++requests;
    const response = await route.fetch();
    if (number === 1) {
      oldBody = await response.text();
      trace.push("document-read");
    }
    await route.fulfill({ response });
    captured.release();
  });
  await page.route("**/api/events**", async (route) => {
    trace.push("stream-request");
    await streams.pending;
    await route.continue();
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/events") opened = true;
  });
  try {
    await page.goto("/");
    await captured.pending;
    await expect(page.locator(".pill-name").first()).toHaveText("synth");
    const body = `first-load-gap-${Date.now().toString(36)}`;
    expect(oldBody).not.toContain(body);
    expect(opened).toBe(false);
    const id = finding("synth", body);
    trace.push("cli-write");
    await heard(observer, id);
    trace.push("other-stream-frame");
    expect(opened).toBe(false);
    streams.release();
    trace.push("new-stream-released");
    await once(page, "synth", id, body);
    expect(requests).toBeGreaterThanOrEqual(2);
    await capture(page, info, "current-min-dark");
    await info.attach("ordering", {
      body: JSON.stringify({ trace, id, requests }),
      contentType: "application/json",
    });
  } finally {
    streams.release();
    await observer.close();
  }
});

test("55.12: a B write reaches its open stream before the captured B document is applied", async ({
  page,
  context,
}, info) => {
  const name = `handover-b-${Date.now().toString(36)}`;
  cli("review", "new", name, "--base", "head", "--no-use");
  const observer = await context.newPage();
  await observe(observer, name);
  await page.goto("/");
  await expect(page.locator(".pill-name").first()).toHaveText("synth");
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  const document = gate();
  const captured = gate();
  const trace: string[] = [];
  let oldBody = "";
  let held = false;
  const connection = await context.newCDPSession(page);
  const frames: string[] = [];
  await connection.send("Network.enable");
  connection.on("Network.eventSourceMessageReceived", (event) => {
    if (event.eventName === "comment-added") {
      frames.push((JSON.parse(event.data) as { id: string }).id);
    }
  });
  await page.route(`**/api/review?review=${name}`, async (route) => {
    const response = await route.fetch();
    if (!held) {
      held = true;
      oldBody = await response.text();
      trace.push("B-document-read");
      captured.release();
    }
    await document.pending;
    await route.fulfill({ response });
  });
  try {
    await page.locator(".pill").first().click();
    await page
      .locator(".session-row")
      .filter({ has: page.getByText(name, { exact: true }) })
      .locator(".session-open")
      .click();
    await captured.pending;
    const body = `switch-read-apply-gap-${Date.now().toString(36)}`;
    expect(oldBody).not.toContain(body);
    const id = finding(name, body);
    trace.push("cli-B-write");
    await heard(observer, id);
    trace.push("other-B-stream-frame");
    await expect.poll(() => frames.includes(id), { timeout: 20_000 }).toBe(true);
    trace.push("tested-B-stream-frame-before-document-apply");
    document.release();
    trace.push("old-B-document-released");
    await once(page, name, id, body);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole("button", { name: "light theme" }).click();
    await capture(page, info, "named-wide-light");
    await info.attach("ordering", {
      body: JSON.stringify({ trace, id, name }),
      contentType: "application/json",
    });
  } finally {
    document.release();
    await connection.detach();
    await observer.close();
  }
});

test("40.2: CLI deletion removes another task's row while its menu stays open", async ({
  page,
}, info) => {
  const name = `handover-delete-${Date.now().toString(36)}`;
  cli("review", "new", name, "--base", "head", "--no-use");
  await page.goto("/");
  await expect(page.locator(".pill-name").first()).toHaveText("synth");
  await expect(page.locator(".sidebar-foot")).toContainText("watching");
  await page.locator(".pill").first().click();
  const menu = page.locator('.menu[aria-label="review sessions"]');
  const row = menu.locator(".session-row").filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toHaveCount(1);
  cli("review", "delete", name, "--role", "human", "--yes");
  await expect(row).toHaveCount(0, { timeout: 20_000 });
  await expect(menu).toBeVisible();
  await expect(page.locator(".pill-name").first()).toHaveText("synth");
  expect(new URL(page.url()).searchParams.get("review")).toBeNull();
  await capture(page, info, "open-history-after-delete");
});
