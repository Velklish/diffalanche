import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/** DA-56.8's walk: every `Tab` stop draws the system's `acc` ring and not the browser's; which
 * states it walks, and which it cannot reach, is in 08-ui.md ("Tokens"). */

test.describe.configure({ timeout: 120_000 });

const root = fileURLToPath(new URL("..", import.meta.url));
const FIXTURE = ".perf/e2e";

/** Far past the fixture's stops (about 180): a walk that reaches it went round in a loop. */
const PAGE_STOPS = 600;
const OVERLAY_STOPS = 80;

type Stop = {
  /** The element itself, told apart from another with the same classes and label. */
  id: number;
  /** The stop's class list and label, for the failure message. */
  what: string;
  /** Its classes alone, for the set of kinds a walk has to reach. */
  kind: string;
  drawn: string;
  system: boolean;
};

/** What the focused element draws, and whether it is the system's ring; `null` on the body. */
function stop(page: Page): Promise<Stop | null> {
  return page.evaluate(async () => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) return null;
    await Promise.all(element.getAnimations().map((one) => one.finished));
    const probe = document.createElement("span");
    document.body.append(probe);
    const token = (name: string) => {
      probe.style.color = `var(${name})`;
      return getComputedStyle(probe).color;
    };
    const [acc, accTx, tx] = [token("--acc"), token("--accTx"), token("--tx")];
    probe.remove();

    // What it draws with the ring and without it: a ring is a change, and a change in `acc`.
    const read = () => {
      const style = getComputedStyle(element);
      const field = element.parentElement === null ? null : getComputedStyle(element.parentElement);
      return {
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
        border: style.borderTopColor,
        field: field?.borderBottomColor ?? "",
      };
    };
    const focused = read();
    const style = getComputedStyle(element);
    const outlineStyle = style.outlineStyle;
    const outline = outlineStyle === "solid" && Number.parseFloat(style.outlineWidth) >= 1;
    const border = style.borderTopStyle !== "none" && Number.parseFloat(style.borderTopWidth) >= 1;
    const [outlineColor, borderColor] = [style.outlineColor, style.borderTopColor];
    element.blur();
    const rest = read();
    element.focus({ preventScroll: true });
    const back = document.activeElement === element && element.matches(":focus-visible");
    const changed =
      focused.outline !== rest.outline ||
      focused.border !== rest.border ||
      focused.field !== rest.field;
    // The ring is `acc`; the two filled controls keep one of their own (DESIGN.md, Inputs and
    // fields), and the search field's is its row's rule, the only edge it has.
    const own =
      (outline && outlineColor === acc) ||
      (border && borderColor === acc) ||
      (element.matches(".primary, .sev-chip.on.auto") && border && borderColor === accTx) ||
      (element.matches(".ok") && border && borderColor === tx) ||
      (element.matches(".palette-field input") && focused.field === acc);
    const system = back && changed && outlineStyle !== "auto" && own;

    const seen = window as unknown as { walkIds?: WeakMap<Element, number>; walkNext?: number };
    seen.walkIds ??= new WeakMap();
    if (!seen.walkIds.has(element)) {
      seen.walkNext = (seen.walkNext ?? 0) + 1;
      seen.walkIds.set(element, seen.walkNext);
    }
    const kind = [...element.classList].sort().join(".") || element.tagName.toLowerCase();
    const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
    return {
      id: seen.walkIds.get(element) as number,
      what: `${kind} "${label.slice(0, 24)}"`,
      kind,
      drawn: `focused ${JSON.stringify(focused)} at rest ${JSON.stringify(rest)}${back ? "" : ", lost the focus"}`,
      system,
    };
  });
}

/** `Tab` (or `key`) from where the focus is, up to `limit` stops or until `done` says it is over. */
async function walk(
  page: Page,
  limit: number,
  done: (at: Stop | null, walked: Stop[]) => boolean | Promise<boolean>,
  key = "Tab",
): Promise<Stop[]> {
  const walked: Stop[] = [];
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press(key);
    const at = await stop(page);
    if (await done(at, walked)) return walked;
    if (at !== null) walked.push(at);
  }
  throw new Error(`the walk did not finish within ${limit} stops`);
}

function foreign(walked: Stop[]): string[] {
  return [
    ...new Set(walked.filter((one) => !one.system).map((one) => `${one.what}: ${one.drawn}`)),
  ];
}

async function ready(page: Page) {
  await page.waitForFunction(() => window.__perf?.ready === true);
  await page.locator(".file-card .diff").first().waitFor();
}

async function open(page: Page, theme: "dark" | "light", path = "/") {
  await page.goto(path);
  await ready(page);
  await page.getByRole("button", { name: `${theme} theme` }).click();
  // Again, so the walk starts at the top of a page that opened in that theme.
  await page.reload();
  await ready(page);
  await expect(page.locator(":root")).toHaveAttribute("data-theme", theme);
}

/** A key first, so the `focus()` the walk starts from shows its ring as a key would: `F2` is bound
 * to nothing, where a modifier alone sets no modality and two `Shift`s are global search. */
async function focusByKey(page: Page, selector: string): Promise<void> {
  await page.keyboard.press("F2");
  await page.locator(selector).first().focus();
  await expect(page.locator(selector).first()).toBeFocused();
}

/** The control that opens an overlay, focused and pressed as the keyboard would. */
async function openByKey(page: Page, opener: string): Promise<void> {
  await focusByKey(page, opener);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Round the overlay's ring once, from where the focus is until a stop comes back. */
async function round(page: Page): Promise<Stop[]> {
  const first = await stop(page);
  if (first === null) throw new Error("the overlay opened with the focus on the body");
  const inside = await walk(
    page,
    OVERLAY_STOPS,
    (at, walked) => at === null || at.id === first.id || walked.some((one) => one.id === at.id),
  );
  return [first, ...inside];
}

/** Every stop inside `region`, forward and back from the one the focus is on. */
async function region(page: Page, inside: string): Promise<Stop[]> {
  const first = await stop(page);
  if (first === null) throw new Error(`nothing in ${inside} has the focus`);
  await page.evaluate(() => {
    (window as unknown as { walkStart: Element | null }).walkStart = document.activeElement;
  });
  const out = (at: Stop | null, walked: Stop[]) =>
    at === null ||
    at.id === first.id ||
    walked.some((one) => one.id === at.id) ||
    page.evaluate((selector) => document.activeElement?.closest(selector) === null, inside);
  const forward = await walk(page, OVERLAY_STOPS, out);
  await page.evaluate(() => {
    ((window as unknown as { walkStart: HTMLElement }).walkStart as HTMLElement).focus();
  });
  const back = await walk(page, OVERLAY_STOPS, out, "Shift+Tab");
  return [first, ...forward, ...back];
}

function kinds(stops: Stop[]): string[] {
  return [...new Set(stops.map((one) => one.kind))];
}

for (const theme of ["dark", "light"] as const) {
  test(`every stop on the page draws the system's ring (${theme})`, async ({ page }) => {
    await open(page, theme);
    const walked = await walk(page, PAGE_STOPS, (at) => at === null);

    // The walk reached what the card's walk did not: past the first card, into the hunks and the rail.
    for (const kind of ["caret", "hunk-expand", "hunk-context", "ok.small"]) {
      expect(kinds(walked), `the walk never reached .${kind}`).toContain(kind);
    }
    expect(foreign(walked)).toEqual([]);
  });

  test(`every stop inside an overlay draws the system's ring (${theme})`, async ({ page }) => {
    await open(page, theme);

    // The panel itself takes the focus as it opens, so the first `Tab` goes inside; each mode
    // of the base picker has fields of its own.
    await openByKey(page, '[data-ladder="base"]');
    const base = await round(page);
    expect(base[0]?.kind).toBe("overlay");
    for (const mode of ["branch", "ref"]) {
      await focusByKey(page, `.picker-head:has(.picker-title:text-is("${mode}"))`);
      await page.keyboard.press("Enter");
      if (mode === "branch") await page.locator(".picker-branch").first().waitFor();
      base.push(...(await round(page)));
    }
    expect(kinds(base)).toEqual(expect.arrayContaining(["picker-branch", "picker-ref"]));
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await openByKey(page, '[data-ladder="export"]');
    const exported = await round(page);
    expect(exported[0]?.kind).toBe("overlay");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // Search takes the focus into its field as it mounts; `ts` is enough hits for `ещё совпадения`.
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("textbox", { name: "search" }).fill("ts");
    await expect(page.locator(".palette-more")).toBeVisible();
    const search = await round(page);
    expect(kinds(search)).toContain("palette-more");

    expect(foreign([...base, ...exported, ...search])).toEqual([]);
  });

  test(`every stop of the comment form and a reply draws the system's ring (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    await page.keyboard.press("c");
    await expect(page.locator(".composer-field")).toBeFocused();
    // Something to send, or `Comment` is disabled and no stop at all.
    await page.keyboard.type("a finding");
    const composer = await region(page, ".composer");
    expect(kinds(composer)).toEqual(expect.arrayContaining(["composer-field", "primary"]));
    await page.keyboard.press("Escape");

    await focusByKey(page, ".thread-widget button:text-is('Reply')");
    await page.keyboard.press("Enter");
    await expect(page.locator(".reply-field").first()).toBeFocused();
    const reply = await region(page, ".reply-form");
    expect(kinds(reply)).toContain("reply-field");

    expect(foreign([...composer, ...reply])).toEqual([]);
  });

  test(`every stop of the sessions menu and its question draws the system's ring (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    await focusByKey(page, ".pill-holder > .pill");
    await page.keyboard.press("Enter");
    await expect(page.locator("section.menu")).toBeVisible();
    // The history arrives after the menu opens; its rows are stops too.
    await page.locator(".session-open").first().waitFor();
    await page.keyboard.press("Tab");
    const menu = await region(page, "section.menu");
    expect(kinds(menu)).toEqual(expect.arrayContaining(["session-open", "menu-base"]));

    await focusByKey(page, "[data-session-delete]");
    await page.keyboard.press("Enter");
    const question = await region(page, ".session-row.asking");
    expect(kinds(question)).toEqual(
      expect.arrayContaining(["ghost.small", "danger.primary.small"]),
    );
    await page.keyboard.press("Escape");

    expect(foreign([...menu, ...question])).toEqual([]);
  });

  test(`every stop of select mode and New task… draws the system's ring (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    await focusByKey(page, ".sidebar-tabs .tab:text-is('select')");
    await page.keyboard.press("Enter");
    await focusByKey(page, ".repo-row");
    await page.keyboard.press("Enter");
    const select = await region(page, ".sidebar");
    expect(kinds(select)).toEqual(expect.arrayContaining(["repo-row", "primary.small"]));

    await openByKey(page, ".sidebar button:text-is('New task…')");
    const task = await round(page);
    await page.keyboard.press("Escape");

    expect(foreign([...select, ...task])).toEqual([]);
  });

  test(`every stop of all files and browse mode draws the system's ring (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    await page.getByRole("button", { name: "all files", exact: true }).click();
    await page.locator(".file-row.unchanged").first().waitFor();
    await focusByKey(page, ".file-row.unchanged");
    const tree = await region(page, ".sidebar");
    expect(kinds(tree)).toContain("file-row.unchanged");

    await focusByKey(page, ".file-row.unchanged");
    await page.keyboard.press("Enter");
    await page.locator(".plain-line").first().waitFor();
    await focusByKey(page, ".plain-card .file-head button");
    const browse = await region(page, ".plain-card");
    expect(kinds(browse)).toEqual(expect.arrayContaining(["ghost.small", "segment"]));

    expect(foreign([...tree, ...browse])).toEqual([]);
  });

  test(`every stop of the scope editor draws the system's ring (${theme})`, async ({
    page,
    request,
  }) => {
    const found = (
      (await (await request.get("/api/sessions/candidates")).json()) as {
        repositories: { path: string; files: { path: string }[] }[];
      }
    ).repositories[0];
    if (found === undefined) throw new Error("the fixture has no repository with changes");
    const name = `focus-${theme}-${Date.now().toString(36)}`;
    execFileSync(
      "bun",
      [
        ...["run", "src/cli/index.ts", "review", "new", name, "--base", "head", "--no-use"],
        ...["--path", `${found.path}:${found.files[0]?.path}`, "--root", FIXTURE],
      ],
      { cwd: root },
    );
    try {
      await open(page, theme, `/?review=${name}`);
      await openByKey(page, '[data-ladder="scope"]');
      // The whole root is read as the editor opens; its rows are stops once they are there.
      await page.locator(".scope-row").first().waitFor();
      const scope = await round(page);
      expect(kinds(scope)).toEqual(expect.arrayContaining(["scope-row", "primary"]));
      expect(foreign(scope)).toEqual([]);
    } finally {
      // The history other specs read would list it.
      execFileSync(
        "bun",
        [
          ...["run", "src/cli/index.ts", "review", "delete", name, "--role", "human", "--yes"],
          ...["--root", FIXTURE],
        ],
        { cwd: root },
      );
    }
  });

  test(`the footer's reconnect and the line after it draw the system's ring (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    let refused = true;
    await page.route("**/api/events*", (route) =>
      refused ? route.fulfill({ status: 503, body: "" }) : route.fallback(),
    );
    await page.reload();
    await page.waitForFunction(() => window.__perf?.ready === true);
    await expect(page.locator(".sidebar-foot")).toContainText("disconnected");
    await focusByKey(page, ".foot-action");
    const button = await stop(page);
    refused = false;
    await page.keyboard.press("Enter");
    await expect(page.locator(".sidebar-foot")).toContainText("watching");
    const line = await stop(page);
    expect([button?.kind, line?.kind]).toEqual(["foot-action", "sidebar-foot"]);
    expect(foreign([button as Stop, line as Stop])).toEqual([]);
  });
}

/** What `GET /api/review` answers for a session whose base leaves nothing to review. */
const NO_CHANGES = {
  root: "/root",
  repositories: [],
  totals: { repositories: 0, files: 0, lines: 0 },
  session: {
    version: 1,
    name: "ls-ref",
    title: "",
    base: { mode: "ref", ref: "v0.3.1" },
    createdAt: "2026-09-05T00:00:00Z",
    updatedAt: "2026-09-05T00:00:00Z",
  },
  comments: [],
  counters: {
    counters: { total: 0, open: 0, resolved: 0, unanswered: 0, awaiting: 0, severity: null },
    repositories: [],
  },
  warnings: [],
};

for (const theme of ["dark", "light"] as const) {
  test(`every stop with both panels away and on the empty screens draws the system's ring (${theme})`, async ({
    page,
  }) => {
    await open(page, theme);
    await page.getByRole("button", { name: "hide the navigation" }).click();
    await page.getByRole("button", { name: "hide the threads" }).click();
    await page.reload();
    await ready(page);
    const away = await walk(page, PAGE_STOPS, (at) => at === null);
    expect(kinds(away)).toContain("panel-toggle");
    await page.getByRole("button", { name: "show the navigation" }).click();
    await page.getByRole("button", { name: "show the threads" }).click();

    await page.route("**/api/review*", (route) => route.fulfill({ json: NO_CHANGES }));
    await page.reload();
    await page.getByRole("button", { name: "Change base" }).waitFor();
    const none = await walk(page, PAGE_STOPS, (at) => at === null);

    await page.route("**/api/review*", (route) =>
      route.fulfill({
        status: 404,
        json: { error: "no-current-session", message: "no current review session" },
      }),
    );
    await page.reload();
    await page.getByRole("textbox", { name: "session name" }).waitFor();
    const first = await walk(page, PAGE_STOPS, (at) => at === null);
    expect(kinds(first)).toContain("first-run-name");

    expect(foreign([...away, ...none, ...first])).toEqual([]);
  });
}
