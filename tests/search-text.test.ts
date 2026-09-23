/** Text search over the working trees of a review (DA-38): `git grep` for a fixed string, capped
 * and paged, each hit with its neighbours, and nothing written to the repository it reads. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession } from "../src/core/domain/index.ts";
import { grepWorktree } from "../src/core/git/grep.ts";
import type { TextSearch } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";
import {
  TEXT_CAP,
  TEXT_NEIGHBOURS,
  TEXT_PAGE,
  TEXT_PER_FILE,
} from "../src/server/routes/search.ts";

const ALPHA = "repos/g/alpha";
const BETA = "repos/g/beta";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  });
}

function lines(count: number, word: (n: number) => string): string {
  return `${Array.from({ length: count }, (_, index) => word(index + 1)).join("\n")}\n`;
}

let root: string;
let app: Hono;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-grep-"));
  mkdirSync(join(root, ".diffalanche"), { recursive: true });
  writeFileSync(join(root, ".diffalanche", "config.json"), '{ "roots": ["repos"], "depth": 2 }\n');
  for (const repo of [ALPHA, BETA]) {
    const dir = join(root, repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "code.ts"),
      lines(20, (n) => (n === 12 ? "const Needle = 1;" : `line ${n}`)),
    );
    writeFileSync(join(dir, "blob.bin"), Buffer.from("needle\0binary"));
    writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "add", "-A");
    git(dir, "-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "init");
    // A change, so the repository is in the review; an untracked file and an ignored one.
    writeFileSync(join(dir, "changed.txt"), "an untracked needle\n");
    writeFileSync(join(dir, "ignored.txt"), "needle in an ignored file\n");
  }
  // More files holding the word than the cap has room for, five lines each.
  mkdirSync(join(root, ALPHA, "many"), { recursive: true });
  for (let file = 0; file < TEXT_CAP / TEXT_PER_FILE + 10; file += 1) {
    writeFileSync(
      join(root, ALPHA, "many", `f${file}.txt`),
      lines(5, (n) => `needle ${n}`),
    );
  }
  writeFileSync(join(root, BETA, "a.b*c.txt"), "the text a.b*c literally\n");

  const config = await loadConfig({ root });
  await createSession(config.dataDir, "all", { mode: "head" }, undefined);
  await createSession(config.dataDir, "one-file", { mode: "head" }, undefined, {
    use: false,
    scope: [{ repo: BETA, paths: ["changed.txt", "code.ts"] }],
  });
  app = createApp({
    activity: createActivityLog(),
    config,
    events: createEventStream(),
    review: createReviewService(config),
    ui: { read: async () => null },
  });
  expect((await app.request("/api/review")).status).toBe(200);
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function search(query: string, extra = ""): Promise<TextSearch> {
  const response = await app.request(`/api/search/text?q=${encodeURIComponent(query)}${extra}`);
  expect(response.status).toBe(200);
  return (await response.json()) as TextSearch;
}

describe("git grep over one working tree", () => {
  it("finds a fixed string, case folded, in tracked and untracked files, never a binary or an ignored one", async () => {
    const { matches, capped } = await grepWorktree(join(root, BETA), "NEEDLE", {
      limit: 100,
      perFile: 3,
    });
    expect(capped).toBe(false);
    expect(matches).toEqual([
      { path: "changed.txt", line: 1, text: "an untracked needle" },
      { path: "code.ts", line: 12, text: "const Needle = 1;" },
    ]);
  });

  it("reads the query as text, not as a pattern", async () => {
    const { matches } = await grepWorktree(join(root, BETA), "a.b*c", { limit: 100, perFile: 3 });
    expect(matches.map((one) => one.path)).toEqual(["a.b*c.txt"]);
  });

  it("keeps a few lines of each file, and stops at the limit saying there was more", async () => {
    const { matches, capped } = await grepWorktree(join(root, ALPHA), "needle", {
      limit: 7,
      perFile: 2,
    });
    expect(matches).toHaveLength(7);
    expect(capped).toBe(true);
    const perPath = new Map<string, number>();
    for (const one of matches) perPath.set(one.path, (perPath.get(one.path) ?? 0) + 1);
    expect(Math.max(...perPath.values())).toBe(2);
  });

  it("sets aside a file of one word repeated, so a file after it is still read", async () => {
    const dir = join(root, "hog");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    // Sorted first, and far more lines than the whole read allows for a limit of ten.
    writeFileSync(
      join(dir, "a-many.txt"),
      lines(1000, () => "needle"),
    );
    writeFileSync(join(dir, "z-one.txt"), "one needle at the end\n");
    const { matches, capped } = await grepWorktree(dir, "needle", { limit: 10, perFile: 3 });
    expect(matches.map((one) => `${one.path}:${one.line}`)).toEqual([
      "a-many.txt:1",
      "a-many.txt:2",
      "a-many.txt:3",
      "z-one.txt:1",
    ]);
    expect(capped).toBe(false);
  });

  it("writes nothing: the index and the refs are byte for byte what they were", async () => {
    const dir = join(root, ALPHA);
    const index = readFileSync(join(dir, ".git", "index"));
    const head = readFileSync(join(dir, ".git", "HEAD"));
    await grepWorktree(dir, "line", { limit: 1000, perFile: 1000 });
    expect(readFileSync(join(dir, ".git", "index")).equals(index)).toBe(true);
    expect(readFileSync(join(dir, ".git", "HEAD")).equals(head)).toBe(true);
  });
});

describe("GET /api/search/text", () => {
  it("lists matches from every repository of the review, each with its neighbours", async () => {
    const result = await search("const needle");
    expect(result.hits.map((hit) => hit.repo)).toEqual([ALPHA, BETA]);
    const [hit] = result.hits;
    expect(hit).toMatchObject({ path: "code.ts", line: 12, text: "const Needle = 1;" });
    expect(hit?.before).toEqual(["line 7", "line 8", "line 9", "line 10", "line 11"]);
    expect(hit?.after).toHaveLength(TEXT_NEIGHBOURS);
    expect(hit?.after[0]).toBe("line 13");
  });

  it("stops at the cap and pages what it kept", async () => {
    const first = await search("needle");
    expect(first.capped).toBe(true);
    expect(first.total).toBe(TEXT_CAP);
    expect(first.hits).toHaveLength(TEXT_PAGE);
    expect(first.next).toBe(1);
    const last = await search("needle", `&page=${TEXT_CAP / TEXT_PAGE - 1}`);
    expect(last.hits).toHaveLength(TEXT_PAGE);
    expect(last.next).toBeNull();
  });

  it("searches what the task's scope names and nothing else", async () => {
    const result = await search("needle", "&review=one-file");
    expect(result.hits.map((hit) => `${hit.repo}/${hit.path}`)).toEqual([
      `${BETA}/changed.txt`,
      `${BETA}/code.ts`,
    ]);
  });

  it("answers a query too short to be a search with nothing, and refuses a malformed one", async () => {
    expect((await search("n")).hits).toEqual([]);
    expect((await app.request("/api/search/text?q=ab&page=-1")).status).toBe(400);
    expect((await app.request("/api/search/text?q=a%0Ab")).status).toBe(400);
  });
});
