/**
 * The comment commands of DA-14 on a fixture root: what an agent reads, what it
 * writes, and the one thing only a human may do (`docs/SPEC.md` sections 8 and
 * 9, [ADR-004](../docs/adr/adr-004-agent-contract.md)).
 */
import { execFile } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import { exportMarkdown } from "../src/core/domain/index.ts";
import type { Comment } from "../src/core/storage/index.ts";
import { updateComments } from "../src/core/storage/index.ts";
import type { UiAssets } from "../src/server/assets.ts";
import {
  EDITED_AFTER,
  EDITED_LINE,
  makeRoot,
  REPOS,
  resetWorkingTrees,
} from "./helpers/fixture-root.ts";

const execFileAsync = promisify(execFile);
const noUi: UiAssets = { read: async () => null };

/**
 * Whether the runtime running the tests can start the CLI from its TypeScript
 * source: Bun always can, and Node has stripped types without a flag since
 * 22.18. The published bundle needs neither, so `engines.node` stays at 22 and
 * only this one test asks for more.
 */
const runsTypeScript = ((): boolean => {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") return true;
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
})();

const ALPHA = REPOS[0];

let root: string;

type Result = { code: number; out: string; err: string };

async function invoke(argv: string[], stdin?: string): Promise<Result> {
  let out = "";
  let err = "";
  const code = await run([...argv, "--root", root], noUi, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    input: async () => stdin ?? "",
  });
  return { code, out, err };
}

function comments(): Comment[] {
  const file = join(root, ".diffalanche", "reviews", "alpha", "comments.json");
  return JSON.parse(readFileSync(file, "utf8")).comments;
}

/** The id of the comment a command just wrote: it is the first word of the line. */
function idOf(result: Result): string {
  expect(result.code).toBe(0);
  return result.out.split(" ")[0] ?? "";
}

async function openFinding(...extra: string[]): Promise<string> {
  return idOf(
    await invoke([
      "comment",
      "--repo",
      ALPHA,
      "--path",
      "file.txt",
      "--line",
      String(EDITED_LINE),
      "--severity",
      "warning",
      "--body",
      "the fallback is unreachable",
      ...extra,
    ]),
  );
}

// The repositories are built once: no test here commits, and the one that edits
// a working tree is undone by `resetWorkingTrees`. Only the data directory is
// new for each test, which is what the tests actually write to.
beforeAll(() => {
  root = makeRoot();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  rmSync(join(root, ".diffalanche", "reviews"), { recursive: true, force: true });
  rmSync(join(root, ".diffalanche", "current"), { force: true });
  resetWorkingTrees(root);
  await invoke(["review", "new", "alpha"]);
  await invoke(["diff", "--json"]);
});

describe("comment", () => {
  it("stores the line the anchor was taken from", async () => {
    const id = await openFinding();
    const [written] = comments();
    expect(written).toMatchObject({
      id,
      repo: ALPHA,
      path: "file.txt",
      line: EDITED_LINE,
      side: "new",
      severity: "warning",
      status: "open",
      // `docs/SPEC.md` section 8: an agent that names neither is an agent.
      author: "agent",
      role: "agent",
    });
    expect(written?.anchor?.lineContent).toBe(EDITED_AFTER);
    expect(written?.anchor?.hunk).toMatch(/^@@ /);
  });

  it("reads the repository again, so a line edited after the scan anchors to what is there now", async () => {
    const file = join(root, ALPHA, "file.txt");
    const lines = readFileSync(file, "utf8").split("\n");
    lines[EDITED_LINE - 1] = "five, changed again";
    writeFileSync(file, lines.join("\n"));

    await openFinding();
    expect(comments()[0]?.anchor?.lineContent).toBe("five, changed again");
    // The cache was brought up to date rather than replaced by one repository.
    const cache = JSON.parse(
      readFileSync(join(root, ".diffalanche", "reviews", "alpha", "diff.json"), "utf8"),
    );
    expect(cache.repositories).toHaveLength(2);
  });

  it("refuses a --repo no repository is at, before it writes anything", async () => {
    const before = readFileSync(
      join(root, ".diffalanche", "reviews", "alpha", "diff.json"),
      "utf8",
    );
    const result = await invoke([
      "comment",
      "--repo",
      "repos/group/gamma",
      "--severity",
      "nit",
      "--body",
      "x",
    ]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('no repository "repos/group/gamma" under the root');
    expect(comments()).toHaveLength(0);
    // Nothing was rewritten on the way out, and no bogus warning was recorded.
    expect(readFileSync(join(root, ".diffalanche", "reviews", "alpha", "diff.json"), "utf8")).toBe(
      before,
    );
  });

  it("rescans when the base changed, instead of patching a cache of the previous one", async () => {
    // Two `ref` bases that resolve to the same revision and record themselves
    // differently in every repository: same mode, different ref, so only a
    // comparison that looks past the mode sees that the cache is the answer to
    // the previous question.
    await invoke(["review", "base", "main"]);
    await invoke(["diff", "--json"]);
    const before = JSON.parse(
      readFileSync(join(root, ".diffalanche", "reviews", "alpha", "diff.json"), "utf8"),
    );
    expect(before.repositories.map((one: { base: { ref: string } }) => one.base.ref)).toEqual([
      "main",
      "main",
    ]);

    await invoke(["review", "base", "HEAD"]);
    const id = await openFinding();

    const cache = JSON.parse(
      readFileSync(join(root, ".diffalanche", "reviews", "alpha", "diff.json"), "utf8"),
    );
    expect(cache.base).toEqual({ mode: "ref", ref: "HEAD" });
    expect(cache.repositories).toHaveLength(2);
    // Every repository, not only the one the comment names, was read against
    // the base the session asks for now.
    expect(cache.repositories.map((one: { base: { ref: string } }) => one.base.ref)).toEqual([
      "HEAD",
      "HEAD",
    ]);
    expect(comments().find((one) => one.id === id)?.anchor?.lineContent).toBe(EDITED_AFTER);
  });

  it("anchors on a file, on a repository, and on the review", async () => {
    await invoke([
      "comment",
      "--repo",
      ALPHA,
      "--path",
      "file.txt",
      "--severity",
      "nit",
      "--body",
      "a file",
    ]);
    await invoke(["comment", "--repo", ALPHA, "--severity", "nit", "--body", "a repository"]);
    await invoke(["comment", "--severity", "nit", "--body", "the review"]);
    expect(comments().map((one) => [one.repo, one.path, one.line])).toEqual([
      [ALPHA, "file.txt", null],
      [ALPHA, null, null],
      [null, null, null],
    ]);
  });

  it("reads the body from standard input for -", async () => {
    const id = idOf(
      await invoke(
        ["comment", "--repo", ALPHA, "--severity", "nit", "--body", "-"],
        "two lines\nof finding\n",
      ),
    );
    expect(comments().find((one) => one.id === id)?.body).toBe("two lines\nof finding");
  });

  it("refuses a severity that is not one, a missing body, and a line the diff does not have", async () => {
    const severity = await invoke(["comment", "--repo", ALPHA, "--severity", "bad", "--body", "x"]);
    expect(severity.code).toBe(1);
    expect(severity.err).toContain("--severity: expected critical, warning, nit, question");

    const body = await invoke(["comment", "--repo", ALPHA, "--severity", "nit"]);
    expect(body.code).toBe(1);
    expect(body.err).toContain("--body is required");

    const empty = await invoke(
      ["comment", "--repo", ALPHA, "--severity", "nit", "--body", "-"],
      "\n",
    );
    expect(empty.code).toBe(1);
    expect(empty.err).toContain("expected text");

    const line = await invoke([
      "comment",
      "--repo",
      ALPHA,
      "--path",
      "file.txt",
      "--line",
      "9000",
      "--severity",
      "nit",
      "--body",
      "x",
    ]);
    expect(line.code).toBe(1);
    expect(comments()).toHaveLength(0);
  });
});

describe("list and show", () => {
  it("moves a human's comment out of --unanswered when an agent replies", async () => {
    const id = await openFinding("--role", "human", "--author", "kim.p");

    const before = await invoke(["list", "--unanswered", "--json"]);
    expect(before.code).toBe(0);
    expect(JSON.parse(before.out).map((one: Comment) => one.id)).toEqual([id]);

    const replied = await invoke(["reply", id, "--body", "fixed: the fallback is gone"]);
    expect(replied).toMatchObject({ code: 0, err: "" });
    expect(replied.out).toContain("r_1");

    const after = await invoke(["list", "--unanswered", "--json"]);
    expect(JSON.parse(after.out)).toEqual([]);
    expect(comments()[0]?.replies).toMatchObject([{ id: "r_1", author: "agent", role: "agent" }]);
  });

  it("filters by status, repository, and severity, and defaults to the open ones", async () => {
    const warning = await openFinding("--role", "human");
    await invoke(["comment", "--repo", REPOS[1], "--severity", "nit", "--body", "elsewhere"]);
    await invoke(["resolve", warning, "--role", "human", "--author", "kim.p"]);

    const open = await invoke(["list", "--json"]);
    expect(JSON.parse(open.out).map((one: Comment) => one.repo)).toEqual([REPOS[1]]);

    const all = await invoke(["list", "--status", "all", "--json"]);
    expect(JSON.parse(all.out)).toHaveLength(2);

    const byRepo = await invoke(["list", "--status", "all", "--repo", ALPHA, "--json"]);
    expect(JSON.parse(byRepo.out).map((one: Comment) => one.id)).toEqual([warning]);

    const bySeverity = await invoke(["list", "--status", "all", "--severity", "nit", "--json"]);
    expect(JSON.parse(bySeverity.out)).toHaveLength(1);
  });

  it("takes --repo from the comments, not from the file system", async () => {
    await openFinding();

    // Beta is a repository under the root and has no comment: a check against
    // the file system would let it through, and there is nothing to list.
    const onDisk = await invoke(["list", "--repo", REPOS[1], "--json"]);
    expect(onDisk.code).toBe(1);
    expect(onDisk.err).toContain(`no comment in this review session is on "${REPOS[1]}"`);
    expect(onDisk.out).toBe("");

    // A repository that is gone from the root keeps everything that was said
    // about it, and `list` is how that is read back.
    await updateComments(join(root, ".diffalanche"), "alpha", (all) => {
      all.push({ ...(all[0] as Comment), id: "c_gone01", repo: "repos/group/gone" });
    });
    const gone = await invoke(["list", "--repo", "repos/group/gone", "--json"]);
    expect(gone).toMatchObject({ code: 0, err: "" });
    expect(JSON.parse(gone.out).map((one: Comment) => one.id)).toEqual(["c_gone01"]);
  });

  it("prints a table without --json and says so when nothing matches", async () => {
    const empty = await invoke(["list"]);
    expect(empty).toMatchObject({ code: 0, err: "" });
    expect(empty.out).toContain("no comments match");

    await openFinding();
    const listed = await invoke(["list"]);
    expect(listed.out).toContain("warning");
    expect(listed.out).toContain(`${ALPHA}/file.txt:${EDITED_LINE}`);
    expect(listed.out).toContain("the fallback is unreachable");
  });

  it("shows one thread with its anchor, and refuses an id it does not have", async () => {
    const id = await openFinding();
    await invoke(["reply", id, "--body", "looking at it"]);

    const shown = await invoke(["show", id]);
    expect(shown).toMatchObject({ code: 0, err: "" });
    expect(shown.out).toContain(id);
    expect(shown.out).toContain(`> ${EDITED_AFTER}`);
    expect(shown.out).toContain("looking at it");

    const asJson = await invoke(["show", id, "--json"]);
    expect(JSON.parse(asJson.out)).toMatchObject({ id, anchor: { lineContent: EDITED_AFTER } });

    const missing = await invoke(["show", "c_nope00"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no comment c_nope00");
  });
});

describe("resolve and reopen", () => {
  it("refuses anything but --role human and changes nothing", async () => {
    const id = await openFinding();
    for (const argv of [
      ["resolve", id],
      ["resolve", id, "--role", "agent"],
      ["reopen", id],
    ]) {
      const refused = await invoke(argv);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("only a human may");
      expect(refused.out).toBe("");
    }
    expect(comments()[0]).toMatchObject({ status: "open", resolvedAt: null, resolvedBy: null });
    const open = await invoke(["list", "--status", "open", "--json"]);
    expect(JSON.parse(open.out).map((one: Comment) => one.id)).toEqual([id]);
  });

  it("closes a thread for a human, with the note in it, and opens it again", async () => {
    const id = await openFinding();
    const resolved = await invoke([
      "resolve",
      id,
      "--role",
      "human",
      "--author",
      "kim.p",
      "--note",
      "checked",
    ]);
    expect(resolved).toMatchObject({ code: 0, err: "" });
    expect(comments()[0]).toMatchObject({ status: "resolved", resolvedBy: "kim.p" });
    expect(comments()[0]?.replies.at(-1)).toMatchObject({ body: "checked", role: "human" });
    expect(JSON.parse((await invoke(["list", "--status", "open", "--json"])).out)).toEqual([]);

    const reopened = await invoke(["reopen", id, "--role", "human", "--author", "kim.p"]);
    expect(reopened.code).toBe(0);
    expect(comments()[0]).toMatchObject({ status: "open", resolvedAt: null, resolvedBy: null });
  });
});

describe("export", () => {
  it("prints what the domain exports, and the open comments by default", async () => {
    const open = await openFinding();
    const closed = await openFinding("--body", "already handled");
    await invoke(["resolve", closed, "--role", "human", "--author", "kim.p"]);

    const review = JSON.parse(
      readFileSync(join(root, ".diffalanche", "reviews", "alpha", "review.json"), "utf8"),
    );
    const onlyOpen = comments().filter((one) => one.status === "open");
    expect((await invoke(["export"])).out).toBe(exportMarkdown(review, onlyOpen));
    expect((await invoke(["export", "--status", "all"])).out).toBe(
      exportMarkdown(review, comments()),
    );

    const asJson = await invoke(["export", "--format", "json"]);
    expect(JSON.parse(asJson.out)).toMatchObject({
      review: { name: "alpha" },
      comments: [{ id: open }],
    });
  });
});

describe("two processes", () => {
  it("both replies land in comments.json when they are written at the same moment", async (context) => {
    if (!runsTypeScript) {
      context.skip(
        `Node ${process.versions.node} cannot start the CLI from its source; this test needs 22.18 or newer, or Bun`,
      );
    }
    const first = await openFinding();
    const second = await openFinding("--body", "and another");

    // The runner's own runtime starts the CLI from source: Bun runs
    // TypeScript, and Node has stripped types since 22.18.
    const reply = (id: string, author: string) =>
      execFileAsync(
        process.execPath,
        [
          "src/cli/index.ts",
          "reply",
          id,
          "--body",
          `from ${author}`,
          "--author",
          author,
          "--root",
          root,
        ],
        { cwd: process.cwd() },
      );
    await Promise.all([reply(first, "one"), reply(second, "two")]);

    const written = comments();
    expect(written.find((one) => one.id === first)?.replies).toMatchObject([{ author: "one" }]);
    expect(written.find((one) => one.id === second)?.replies).toMatchObject([{ author: "two" }]);
  }, 20_000);
});
