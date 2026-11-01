import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import { SCAN_CONCURRENCY, scanReview } from "../src/core/change-set.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { locateAnchor } from "../src/core/domain/anchors.ts";
import {
  addComment,
  countReview,
  createSession,
  get,
  list,
  reopen,
  reply,
  resolve,
} from "../src/core/domain/index.ts";
import { commentWarnings, reconcileAnchors } from "../src/core/domain/reanchor.ts";
import * as anchorMappings from "../src/core/git/anchors.ts";
import { reverseAnchor } from "../src/core/git/anchors.ts";
import * as fileSources from "../src/core/git/browse.ts";
import { fileSourceAt } from "../src/core/git/browse.ts";
import * as repositoryReads from "../src/core/git/index.ts";
import * as gitCalls from "../src/core/git/run.ts";
import { scan } from "../src/core/scanner/index.ts";
import {
  commentsPath,
  readComments,
  readDiffCache,
  readReview,
  updateComments,
  updateSession,
  writeCurrent,
  writeDiffCache,
} from "../src/core/storage/index.ts";
import {
  createActivityLog,
  createEventBus,
  rescanRepository,
  startWatcher,
} from "../src/core/watcher/index.ts";
import { createReviewService } from "../src/server/review.ts";
import { untouched } from "./helpers/untouched.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-reanchor-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  const text = "const before = 1;\nconst anchor = 42;\nconst after = 3;\n";
  const file = join(repo, "a.ts");
  writeFileSync(file, text);
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(file, `${text}const added = 4;\n`);
  const config = await loadConfig({ root, dataDir: join(root, "data") }, root, {
    env: {},
    configHome: join(root, "config"),
  });
  await createSession(config.dataDir, "work", { mode: "head" });
  const scanned = await scanReview(config, { mode: "head" });
  await writeDiffCache(config.dataDir, "work", scanned.cache);
  const comment = await addComment(
    config.dataDir,
    "work",
    {
      repo: "repo",
      path: "a.ts",
      line: 2,
      severity: "warning",
      body: "keep this thread",
      author: "human",
      role: "human",
    },
    { source: fileSourceAt(root, config.dataDir) },
  );
  return { root, repo, file, text, git, config, scanned, comment };
}

describe("re-anchoring through public refresh", () => {
  it("moves an existing comment five lines before refresh resolves", async () => {
    const f = await fixture();
    const watching = await startWatcher({
      config: f.config,
      scan: await scan(f.root, { roots: [f.root], depth: 2, exclude: [] }),
      bus: createEventBus(),
      activity: createActivityLog(),
      recursive: true,
      native: () => ({ polling: false, ready: Promise.resolve(), close: () => undefined }),
    });
    try {
      writeFileSync(f.file, `// 1\n// 2\n// 3\n// 4\n// 5\n${f.text}const added = 4;\n`);
      await watching.refresh();
      expect((await get(f.config.dataDir, "work", f.comment.id)).line).toBe(7);
    } finally {
      await watching.close();
    }
  });
});

async function refresh(f: Awaited<ReturnType<typeof fixture>>) {
  const watching = await startWatcher({
    config: f.config,
    scan: await scan(f.root, { roots: [f.root], depth: 2, exclude: [] }),
    bus: createEventBus(),
    activity: createActivityLog(),
    recursive: true,
    native: () => ({ polling: false, ready: Promise.resolve(), close: () => undefined }),
  });
  try {
    await watching.refresh();
  } finally {
    await watching.close();
  }
  return get(f.config.dataDir, "work", f.comment.id);
}

const prefix = "// 1\n// 2\n// 3\n// 4\n// 5\n";

describe("persisted anchoring", () => {
  it("maps committed insertions and retains the original text", async () => {
    const f = await fixture();
    writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
    f.git("add", ".");
    f.git("commit", "-qm", "insert above");
    const moved = await refresh(f);
    expect(moved).toMatchObject({
      line: 7,
      status: "open",
      originalAnchor: { line: 2, anchor: { lineContent: "const anchor = 42;" } },
    });
    expect((await refresh(f)).line).toBe(7);
  });

  it("maps combined staged and unstaged insertions", async () => {
    const f = await fixture();
    writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
    f.git("add", "a.ts");
    writeFileSync(f.file, `// unstaged\n${prefix}${f.text}const added = 4;\n`);
    expect((await refresh(f)).line).toBe(8);
  });

  it("uses unique text for untracked and uncommitted lines", async () => {
    const f = await fixture();
    const path = join(f.repo, "fresh.ts");
    writeFileSync(path, "const unique = 'not committed';\n");
    await writeDiffCache(
      f.config.dataDir,
      "work",
      (await scanReview(f.config, { mode: "head" })).cache,
    );
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "fresh.ts",
        line: 1,
        severity: "nit",
        body: "new",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    writeFileSync(path, `${prefix}const unique = 'not committed';\n`);
    expect((await refresh(f)).line).toBe(6);
  });

  it("retains a failed anchor across refresh and restart, until human reopen", async () => {
    const f = await fixture();
    writeFileSync(
      f.file,
      f.text.replace("const anchor = 42;", "throw new Error('unrelated replacement');"),
    );
    const lost = await refresh(f);
    expect(lost).toMatchObject({ status: "orphaned", line: 2, anchor: f.comment.anchor });
    expect(
      JSON.parse(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8")).comments[0].anchor,
    ).toEqual(f.comment.anchor);
    writeFileSync(f.file, `${prefix}${f.text}`);
    expect(await refresh(f)).toEqual(lost);
    await expect(
      reopen(f.config.dataDir, "work", f.comment.id, { role: "agent", author: "agent" }),
    ).rejects.toThrow();
    const anchor = f.comment.anchor;
    if (anchor === null) throw new Error("fixture has no anchor");
    await updateComments(f.config.dataDir, "work", (comments) => {
      const c = comments[0];
      if (c) {
        c.line = 7;
        c.anchor = { ...anchor, before: ["const before = 1;"] };
      }
    });
    expect(
      (await reopen(f.config.dataDir, "work", f.comment.id, { role: "human", author: "human" }))
        .status,
    ).toBe("open");
  });

  it("keeps old-side coordinates on the base while the working tree changes", async () => {
    const f = await fixture();
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 2,
        side: "old",
        severity: "nit",
        body: "old",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    writeFileSync(f.file, `${prefix}${f.text}`);
    expect(await refresh(f)).toMatchObject({ line: 2, side: "old", status: "open" });
  });

  it("moves both range endpoints and includes insertions inside a surviving range", async () => {
    const f = await fixture();
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 1,
        endLine: 3,
        severity: "nit",
        body: "range",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    writeFileSync(
      f.file,
      `${prefix}const before = 1;\n// inside\nconst anchor = 42;\nconst after = 3;\n`,
    );
    expect(await refresh(f)).toMatchObject({
      line: 6,
      endLine: 9,
      status: "open",
      anchor: {
        rangeContent: ["const before = 1;", "// inside", "const anchor = 42;", "const after = 3;"],
      },
    });
  });

  it("does not invent an endpoint for a legacy range without captured contents", async () => {
    const f = await fixture();
    await updateComments(f.config.dataDir, "work", (comments) => {
      const c = comments[0];
      if (c) c.endLine = 3;
    });
    writeFileSync(f.file, `${prefix}${f.text}`);
    expect(await refresh(f)).toMatchObject({ status: "orphaned", line: 2, endLine: 3 });
  });

  it("retains a comment when its file returns to base", async () => {
    const f = await fixture();
    writeFileSync(f.file, f.text);
    expect(await refresh(f)).toMatchObject({ status: "open", line: 2 });
  });

  it("does not write the reviewed file or index", async () => {
    const f = await fixture();
    writeFileSync(f.file, `${prefix}${f.text}`);
    const fileUntouched = untouched(f.file);
    const indexUntouched = untouched(join(f.repo, ".git", "index"));
    await refresh(f);
    fileUntouched();
    indexUntouched();
  });
});

describe("unique matching", () => {
  const saved = {
    anchor: {
      lineContent: "const identifier = 12345;",
      hunk: "@@ -1 +1 @@",
      before: [],
      after: [],
    },
    endLine: null,
  };
  it("refuses two qualifying spans without choosing the nearest", () => {
    expect(locateAnchor(saved, "const identifier = 12345;\n\nconst identifier = 12345;\n")).toEqual(
      { kind: "orphaned" },
    );
  });
  it("uses context to disambiguate and normalizes CRLF", () => {
    expect(
      locateAnchor(
        { ...saved, anchor: { ...saved.anchor, before: ["distinctive context"] } },
        "wrong\r\nconst identifier = 12345;\r\ndistinctive context\r\nconst identifier = 12345;\r\n",
      ),
    ).toMatchObject({ kind: "matched", line: 4 });
  });
  it("accepts a small edit above both thresholds and rejects a rewrite", () => {
    expect(locateAnchor(saved, "const identifier = 12346;\n")).toMatchObject({
      kind: "matched",
      line: 1,
    });
    expect(locateAnchor(saved, "unrelated();\n")).toEqual({ kind: "orphaned" });
  });
  it("requires exact context for punctuation and blank anchors", () => {
    const blank = { anchor: { lineContent: "", hunk: "", before: [], after: [] }, endLine: null };
    expect(locateAnchor(blank, "\n")).toEqual({ kind: "orphaned" });
    expect(
      locateAnchor(
        { ...blank, anchor: { ...blank.anchor, before: ["before"], after: ["after"] } },
        "before\n\nafter\n",
      ),
    ).toMatchObject({ kind: "matched", line: 2 });
  });
  it("does not trust a git candidate whose target text no longer matches", () => {
    expect(
      locateAnchor(saved, "unrelated();\n", { lines: [1], content: [saved.anchor.lineContent] }),
    ).toEqual({ kind: "orphaned" });
  });
});

describe("warnings and filters", () => {
  it("keeps saved orphan warnings through unrelated rescan and restart and clears them on reopen", async () => {
    const f = await fixture();
    writeFileSync(f.file, "unrelated();\n");
    await refresh(f);
    const service = createReviewService(f.config);
    expect((await service.document("work")).warnings).toContainEqual({
      path: "repo",
      message: "1 comments lost their anchor in repo",
    });
    writeFileSync(join(f.repo, "unrelated.ts"), "const unrelated = 1;\n");
    await refresh(f);
    expect((await createReviewService(f.config).document("work")).warnings).toContainEqual({
      path: "repo",
      message: "1 comments lost their anchor in repo",
    });
    expect(countReview(await list(f.config.dataDir, "work")).counters).toMatchObject({
      total: 1,
      open: 0,
      resolved: 0,
      unanswered: 0,
      awaiting: 0,
    });
    expect(await list(f.config.dataDir, "work", { status: "orphaned" })).toHaveLength(1);
    expect(
      commentWarnings([], await readComments(f.config.dataDir, "work"), [
        { repo: "other", paths: null },
      ]),
    ).toEqual([]);
    const cli = async (args: string[]) => {
      let out = "";
      let err = "";
      const code = await run(
        [...args, "--root", f.root, "--data-dir", f.config.dataDir, "--review", "work"],
        { read: async () => null },
        {
          out: (text) => {
            out += text;
          },
          err: (text) => {
            err += text;
          },
          input: async () => "",
        },
      );
      return { code, out, err };
    };
    const listed = await cli(["list", "--status", "orphaned", "--json"]);
    expect(listed.code, listed.err).toBe(0);
    expect(JSON.parse(listed.out)).toHaveLength(1);
    const diff = await cli(["diff", "--json"]);
    expect(diff.code, diff.err).toBe(0);
    expect(JSON.parse(diff.out).warnings).toContainEqual({
      path: "repo",
      message: "1 comments lost their anchor in repo",
    });
    expect((await cli(["show", f.comment.id, "--json"])).out).toContain('"orphaned"');
    expect((await cli(["export", "--status", "all", "--format", "json"])).out).toContain(
      '"orphaned"',
    );
    await reopen(f.config.dataDir, "work", f.comment.id, { role: "human", author: "human" });
    service.invalidateComments("work");
    expect((await service.document("work")).warnings).not.toContainEqual({
      path: "repo",
      message: "1 comments lost their anchor in repo",
    });
    expect((await readDiffCache(f.config.dataDir, "work"))?.rootWarnings).toEqual([]);
  });
});

describe("concurrent human writes", () => {
  async function duringRead(action: (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>) {
    const f = await fixture();
    const before = await readDiffCache(f.config.dataDir, "work");
    const review = await readReview(f.config.dataDir, "work");
    writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
    const change = (await scanReview(f.config, review.base)).cache.repositories;
    const source = fileSourceAt(f.root, f.config.dataDir);
    let changed = false;
    await reconcileAnchors(f.config, "work", review, change, before, {
      source: async (...args) => {
        const text = await source(...args);
        if (!changed) {
          changed = true;
          await action(f);
        }
        return text;
      },
    });
    const stored = (await readComments(f.config.dataDir, "work")).find(
      (c) => c.id === f.comment.id,
    );
    if (stored === undefined) throw new Error("fixture comment missing");
    return stored;
  }
  it("preserves a reply while applying an anchor proposal", async () => {
    expect(
      await duringRead((f) =>
        reply(f.config.dataDir, "work", f.comment.id, {
          author: "human",
          role: "human",
          body: "concurrent reply",
        }),
      ),
    ).toMatchObject({ line: 7, replies: [{ body: "concurrent reply" }] });
  });
  it("rejects a proposal after a human resolves the comment", async () => {
    expect(
      await duringRead((f) =>
        resolve(f.config.dataDir, "work", f.comment.id, { author: "human", role: "human" }),
      ),
    ).toMatchObject({ line: 2, status: "resolved", resolvedBy: "human" });
  });
  it("rejects a proposal after a human changes its anchor", async () => {
    expect(
      await duringRead((f) =>
        updateComments(f.config.dataDir, "work", (comments) => {
          const c = comments[0];
          if (c) c.line = 11;
        }),
      ),
    ).toMatchObject({ line: 11 });
  });
  it("rejects a proposal after the scope changes", async () => {
    const result = await duringRead((f) =>
      updateSession(f.config.dataDir, "work", (draft) => {
        draft.review.scope = [{ repo: "other", paths: null }];
      }),
    );
    expect(result.line).toBe(2);
  });
});

describe("git identity and target refusals", () => {
  it("uses reverse blame when the committed target contains duplicate text", async () => {
    const f = await fixture();
    const repeated = `x\nx\nx\n${f.text}y\ny\ny\n`;
    writeFileSync(f.file, repeated);
    f.git("add", "a.ts");
    f.git("commit", "-qm", "unique source context");
    await writeDiffCache(
      f.config.dataDir,
      "work",
      (await scanReview(f.config, { mode: "head" })).cache,
    );
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 5,
        severity: "nit",
        body: "identity",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    const sourceSha = f.git("rev-parse", "HEAD").trim();
    writeFileSync(f.file, `${prefix}${repeated}${repeated}`);
    f.git("add", "a.ts");
    f.git("commit", "-qm", "duplicate target context");
    const porcelain = f.git(
      "blame",
      "--reverse",
      "--line-porcelain",
      "-L",
      "5,5",
      `${sourceSha}..HEAD`,
      "--",
      "a.ts",
    );
    const targetLine = Number(porcelain.split(" ")[1]);
    expect(targetLine).toBeGreaterThan(5);
    expect(await refresh(f)).toMatchObject({ status: "open", line: targetLine });
  });
  it("maps an old-side anchor when its base commit changes", async () => {
    const f = await fixture();
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        side: "old",
        line: 2,
        severity: "nit",
        body: "base",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    writeFileSync(f.file, `${prefix}${f.text}`);
    f.git("add", "a.ts");
    f.git("commit", "-qm", "base moves");
    expect(await refresh(f)).toMatchObject({ status: "open", line: 7, side: "old" });
  });
  it.each(["missing", "binary", "too-large"])(
    "keeps the saved anchor on a %s target",
    async (kind) => {
      const f = await fixture();
      if (kind === "missing") rmSync(f.file);
      else writeFileSync(f.file, kind === "binary" ? "\0binary" : "x".repeat(2_000_000));
      expect(await refresh(f)).toMatchObject({
        status: "orphaned",
        line: 2,
        anchor: f.comment.anchor,
      });
    },
  );
  it("keeps resolved verdict metadata after a successful move", async () => {
    const f = await fixture();
    const resolved = await resolve(f.config.dataDir, "work", f.comment.id, {
      role: "human",
      author: "reviewer",
      note: "done",
    });
    writeFileSync(f.file, `${prefix}${f.text}`);
    expect(await refresh(f)).toMatchObject({
      line: 7,
      status: "resolved",
      resolvedAt: resolved.resolvedAt,
      resolvedBy: "reviewer",
      replies: resolved.replies,
    });
  });
});

it("surfaces a failed file-source process instead of manufacturing an orphan", async () => {
  const f = await fixture();
  const review = await readReview(f.config.dataDir, "work");
  const cache = await readDiffCache(f.config.dataDir, "work");
  await expect(
    reconcileAnchors(f.config, "work", review, f.scanned.cache.repositories, cache, {
      source: async () => {
        throw new Error("git could not be started: ENOENT");
      },
    }),
  ).rejects.toThrow("git could not be started: ENOENT");
  expect((await get(f.config.dataDir, "work", f.comment.id)).status).toBe("open");
});

it("persists anchors before Ready while keeping Ready ahead of diff-cache persistence", async () => {
  const f = await fixture();
  const cachePath = join(f.config.dataDir, "reviews", "work", "diff.json");
  const before = readFileSync(cachePath, "utf8");
  writeFileSync(f.file, `${prefix}${f.text}`);
  let called = false;
  await rescanRepository(f.config, "work", "repo", () => {
    called = true;
    const saved = JSON.parse(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8"));
    expect(saved.comments[0].line).toBe(7);
    expect(readFileSync(cachePath, "utf8")).toBe(before);
  });
  expect(called).toBe(true);
  expect(readFileSync(cachePath, "utf8")).not.toBe(before);
});

it.each(["", ".git/HEAD"])("reconciles before diff-changed for wake path %j", async (wake) => {
  const f = await fixture();
  const signals = new Map<string, (path: string) => void>();
  const bus = createEventBus();
  const errors: unknown[] = [];
  let heard: (() => void) | undefined;
  const received = new Promise<void>((done) => {
    heard = done;
  });
  bus.subscribe((event) => {
    if (event.type !== "diff-changed") return;
    const saved = JSON.parse(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8"));
    expect(saved.comments[0].line).toBe(7);
    heard?.();
  });
  const watching = await startWatcher({
    config: f.config,
    scan: await scan(f.root, { roots: [f.root], depth: 2, exclude: [] }),
    bus,
    activity: createActivityLog(),
    recursive: true,
    debounceMs: 1,
    native: (options) => {
      signals.set(options.dir, options.onChange);
      return { polling: false, ready: Promise.resolve(), close: () => undefined };
    },
    onError: (error) => {
      errors.push(error);
      heard?.();
    },
  });
  try {
    writeFileSync(f.file, `${prefix}${f.text}`);
    const signal = signals.get(f.repo);
    if (signal === undefined) throw new Error("repository watch missing");
    signal(wake);
    await received;
    expect(errors).toEqual([]);
  } finally {
    await watching.close();
  }
});

it("reconciles a session switch before its diff frames", async () => {
  const f = await fixture();
  await createSession(f.config.dataDir, "other", { mode: "head" }, undefined, { use: false });
  await writeDiffCache(f.config.dataDir, "other", f.scanned.cache);
  const other = await addComment(
    f.config.dataDir,
    "other",
    {
      repo: "repo",
      path: "a.ts",
      line: 2,
      severity: "nit",
      body: "other",
      author: "human",
      role: "human",
    },
    { source: fileSourceAt(f.root, f.config.dataDir) },
  );
  const signals = new Map<string, (path: string) => void>();
  const bus = createEventBus();
  let heard: (() => void) | undefined;
  const moved = new Promise<void>((done) => {
    heard = done;
  });
  const errors: unknown[] = [];
  bus.subscribe((event) => {
    if (event.type === "current-changed") heard?.();
  });
  const watching = await startWatcher({
    config: f.config,
    scan: await scan(f.root, { roots: [f.root], depth: 2, exclude: [] }),
    bus,
    activity: createActivityLog(),
    recursive: true,
    debounceMs: 1,
    native: (options) => {
      signals.set(options.dir, options.onChange);
      return { polling: false, ready: Promise.resolve(), close: () => undefined };
    },
    onError: (error) => {
      errors.push(error);
      heard?.();
    },
  });
  try {
    writeFileSync(f.file, `${prefix}${f.text}`);
    await writeCurrent(f.config.dataDir, "other");
    signals.get(f.config.dataDir)?.("current");
    await moved;
    expect(errors).toEqual([]);
    expect((await get(f.config.dataDir, "other", other.id)).line).toBe(7);
  } finally {
    await watching.close();
  }
});

it("does not assign committed identity to an uncommitted copy", async () => {
  const f = await fixture();
  writeFileSync(f.file, `${f.text}${f.text}`);
  await writeDiffCache(
    f.config.dataDir,
    "work",
    (await scanReview(f.config, { mode: "head" })).cache,
  );
  const copy = await addComment(
    f.config.dataDir,
    "work",
    {
      repo: "repo",
      path: "a.ts",
      line: 5,
      severity: "nit",
      body: "copy",
      author: "human",
      role: "human",
    },
    { source: fileSourceAt(f.root, f.config.dataDir) },
  );
  expect(copy.anchor).not.toHaveProperty("revision");
  const original = await get(f.config.dataDir, "work", f.comment.id);
  f.comment = copy;
  expect(await refresh(f)).toMatchObject({ line: 5, status: "orphaned" });
  expect(original.anchor?.revision?.sha).toBe(f.git("rev-parse", "HEAD").trim());
});

it("skips an inconsistent file snapshot instead of persisting a sticky orphan", async () => {
  const f = await fixture();
  const review = await readReview(f.config.dataDir, "work");
  const before = await readDiffCache(f.config.dataDir, "work");
  writeFileSync(f.file, `${prefix}${f.text}`);
  const after = (await scanReview(f.config, review.base)).cache;
  const source = fileSourceAt(f.root, f.config.dataDir);
  await reconcileAnchors(f.config, "work", review, after.repositories, before, {
    source: async (repo, path, rev) => (rev === "worktree" ? null : source(repo, path, rev)),
  });
  expect(await get(f.config.dataDir, "work", f.comment.id)).toMatchObject({
    line: 2,
    status: "open",
  });
});

it("requires the full target file to agree with the captured diff, including unchanged regions", async () => {
  const f = await fixture();
  const review = await readReview(f.config.dataDir, "work");
  const before = await readDiffCache(f.config.dataDir, "work");
  const after = (await scanReview(f.config, review.base)).cache;
  writeFileSync(f.file, `${prefix}${f.text}`);
  await reconcileAnchors(f.config, "work", review, after.repositories, before);
  expect(await get(f.config.dataDir, "work", f.comment.id)).toMatchObject({
    line: 2,
    status: "open",
  });
});

it("does not let stale Git provenance undo a manual orphan re-anchor after human reopen", async () => {
  const f = await fixture();
  writeFileSync(f.file, "unrelated();\n");
  const lost = await refresh(f);
  writeFileSync(f.file, `${prefix}${f.text}manual before\nconst anchor = 42;\nmanual after\n`);
  const anchor = f.comment.anchor;
  if (anchor === null) throw new Error("fixture anchor missing");
  await updateComments(f.config.dataDir, "work", (comments) => {
    const c = comments[0];
    if (c) {
      c.line = 10;
      c.anchor = { ...anchor, before: ["manual before"], after: ["manual after"] };
    }
  });
  await reopen(f.config.dataDir, "work", f.comment.id, { role: "human", author: "human" });
  const moved = await refresh(f);
  expect(moved.originalAnchor).toEqual(lost.originalAnchor);
  expect(moved.anchor).not.toHaveProperty("revision");
  expect(moved).toMatchObject({ line: 10, status: "open" });
  expect(moved.anchor?.before.at(-1)).toBe("manual before");
});

describe("rename and legacy identity", () => {
  it("follows a verified staged rename on the new side and keeps the original path", async () => {
    const f = await fixture();
    f.git("mv", "a.ts", "b.ts");
    writeFileSync(join(f.repo, "b.ts"), `${prefix}${f.text}const added = 4;\n`);
    expect(await refresh(f)).toMatchObject({
      path: "b.ts",
      line: 7,
      status: "open",
      originalAnchor: { path: "a.ts", line: 2 },
    });
  });

  it("reads a renamed old-side anchor from oldPath at its pinned base", async () => {
    const f = await fixture();
    f.git("mv", "a.ts", "b.ts");
    await writeDiffCache(
      f.config.dataDir,
      "work",
      (await scanReview(f.config, { mode: "head" })).cache,
    );
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "b.ts",
        side: "old",
        line: 2,
        severity: "nit",
        body: "renamed old side",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    expect(f.comment.anchor?.revision?.path).toBe("a.ts");
    writeFileSync(join(f.repo, "b.ts"), `${prefix}${f.text}const added = 4;\n`);
    expect(await refresh(f)).toMatchObject({ path: "b.ts", side: "old", line: 2, status: "open" });
  });

  it("uses verified unique text when the saved commit and target are non-ancestral", async () => {
    const f = await fixture();
    const revision = f.comment.anchor?.revision;
    if (revision === undefined) throw new Error("fixture revision missing");
    f.git("checkout", "--orphan", "unrelated");
    f.git("rm", "-rf", ".");
    writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
    f.git("add", "a.ts");
    f.git("commit", "-qm", "unrelated history");
    expect(await reverseAnchor(f.repo, revision, f.git("rev-parse", "HEAD").trim())).toBeNull();
    expect(await refresh(f)).toMatchObject({ line: 7, status: "open" });
  });

  it("uses conservative text fallback for a legacy custom source without revision capture", async () => {
    const f = await fixture();
    const source = fileSourceAt(f.root, f.config.dataDir);
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 2,
        severity: "nit",
        body: "legacy source",
        author: "human",
        role: "human",
      },
      { source: async (repo, path, rev) => source(repo, path, rev) },
    );
    expect(f.comment.anchor).not.toHaveProperty("revision");
    writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
    const moved = await refresh(f);
    expect(moved).toMatchObject({ line: 7, status: "open" });
    expect(moved.anchor).not.toHaveProperty("revision");
  });

  it("keeps the similarity threshold stable around the text-only cutoff", () => {
    const saved = {
      anchor: { lineContent: "abcdefghijklmnopqrst", before: [], after: [], hunk: "" },
      endLine: null,
    };
    expect(locateAnchor(saved, "abcdefghijklmnopqrsX\n")).toMatchObject({
      kind: "matched",
      line: 1,
    });
    expect(locateAnchor(saved, "abcdefghijklmnopqrXY\n")).toEqual({ kind: "orphaned" });
  });
});

describe("review regressions", () => {
  it.each(["new", "old"] as const)(
    "keeps committed rename identity on the %s side when HEAD has no diff",
    async (side) => {
      const f = await fixture();
      f.comment = await addComment(
        f.config.dataDir,
        "work",
        {
          repo: "repo",
          path: "a.ts",
          side,
          line: 2,
          severity: "nit",
          body: "identity",
          author: "human",
          role: "human",
        },
        { source: fileSourceAt(f.root, f.config.dataDir) },
      );
      f.git("mv", "a.ts", "b.ts");
      f.git("commit", "-qam", "committed rename");
      expect(await refresh(f)).toMatchObject({
        path: "b.ts",
        line: 2,
        side,
        status: "open",
        originalAnchor: { path: "a.ts" },
      });
      expect(await refresh(f)).toMatchObject({ path: "b.ts", line: 2, side, status: "open" });
    },
  );

  it("keeps committed rename identity when the old path is recreated with copied text", async () => {
    const f = await fixture();
    f.git("mv", "a.ts", "b.ts");
    f.git("commit", "-qam", "committed rename");
    writeFileSync(f.file, f.text);
    expect(await refresh(f)).toMatchObject({ path: "b.ts", line: 2, status: "open" });
  });

  it.each(["refresh", "CLI diff"])(
    "retains a scoped comment when its rename target is outside the scope through %s",
    async (mode) => {
      const f = await fixture();
      const scope = [{ repo: "repo", paths: ["a.ts"] }];
      await updateSession(f.config.dataDir, "work", (draft) => {
        draft.review.scope = scope;
      });
      f.git("mv", "a.ts", "b.ts");
      if (mode === "refresh") await refresh(f);
      else {
        let err = "";
        let out = "";
        const code = await run(
          ["diff", "--root", f.root, "--data-dir", f.config.dataDir, "--review", "work", "--json"],
          { read: async () => null },
          {
            out: (text) => {
              out += text;
            },
            err: (text) => {
              err += text;
            },
            input: async () => "",
          },
        );
        expect(code, err).toBe(0);
        expect(out).not.toContain("b.ts");
        expect(JSON.parse(out)).not.toHaveProperty("removed");
        expect(JSON.parse(out)).not.toHaveProperty("changes");
      }
      expect((await readComments(f.config.dataDir, "work"))[0]).toMatchObject({
        path: "a.ts",
        line: 2,
        status: "orphaned",
      });
      expect(await list(f.config.dataDir, "work", { status: "all" })).toHaveLength(1);
      expect((await get(f.config.dataDir, "work", f.comment.id)).path).toBe("a.ts");
      expect((await readReview(f.config.dataDir, "work")).scope).toEqual(scope);
      expect((await createReviewService(f.config).document("work")).warnings).toContainEqual({
        path: "repo",
        message: "1 comments lost their anchor in repo",
      });
    },
  );

  it("retains the original anchor when a fallback read sees a config-excluded rename target", async () => {
    const f = await fixture();
    f.config.exclude = ["b.ts"];
    f.git("mv", "a.ts", "b.ts");
    await refresh(f);
    expect(await get(f.config.dataDir, "work", f.comment.id)).toMatchObject({
      path: "a.ts",
      line: 2,
      status: "orphaned",
    });
    expect((await readDiffCache(f.config.dataDir, "work"))?.repositories).toEqual([]);
  });

  it.each([null, 3])(
    "does not invent legacy old-side identity or range body without a previous cache (end=%s)",
    async (endLine) => {
      const f = await fixture();
      writeFileSync(f.file, "A\nTARGET\nB\nTARGET\nC\n");
      f.git("add", "a.ts");
      f.git("commit", "-qm", "unknown legacy base");
      await updateComments(f.config.dataDir, "work", (comments) => {
        const c = comments[0];
        if (c) {
          c.side = "old";
          c.line = 2;
          c.endLine = endLine;
          c.anchor = { lineContent: "TARGET", before: [], after: [], hunk: "" };
          delete c.originalAnchor;
        }
      });
      rmSync(join(f.config.dataDir, "reviews", "work", "diff.json"));
      await createReviewService(f.config).document("work");
      const stored = await get(f.config.dataDir, "work", f.comment.id);
      expect(stored).toMatchObject({ line: 2, endLine, status: "orphaned" });
      expect(stored.anchor).not.toHaveProperty("revision");
      expect(stored.anchor).not.toHaveProperty("rangeContent");
    },
  );

  it("retains committed CRLF identity with duplicate spans through two public refreshes", async () => {
    const f = await fixture();
    f.git("config", "core.autocrlf", "false");
    writeFileSync(join(f.repo, ".gitattributes"), "a.ts -text\n");
    f.git("add", ".gitattributes");
    writeFileSync(f.file, "A\r\nTARGET\r\nB\r\nA\r\nTARGET\r\nB\r\n");
    f.git("add", "a.ts");
    f.git("commit", "-qm", "committed CRLF duplicates");
    expect(f.git("cat-file", "blob", "HEAD:a.ts")).toContain("\r\n");
    await writeDiffCache(
      f.config.dataDir,
      "work",
      (await scanReview(f.config, { mode: "head" })).cache,
    );
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 2,
        severity: "nit",
        body: "CRLF identity",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    expect(await refresh(f)).toMatchObject({ line: 2, status: "open" });
    expect(await refresh(f)).toMatchObject({ line: 2, status: "open" });
    expect((await get(f.config.dataDir, "work", f.comment.id)).anchor?.revision?.sha).toBe(
      f.git("rev-parse", "HEAD").trim(),
    );
  });

  it("keeps persisted anchor and Ready cache on the captured T1 during a T1 to T2 to T1 mapping race", async () => {
    const f = await fixture();
    const base = "A\nTARGET\nB\nTARGET\nC\n";
    writeFileSync(f.file, base);
    f.git("add", "a.ts");
    f.git("commit", "-qm", "duplicate identity source");
    await writeDiffCache(
      f.config.dataDir,
      "work",
      (await scanReview(f.config, { mode: "head" })).cache,
    );
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 2,
        severity: "nit",
        body: "race identity",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    const t1 = `${base}D\n`;
    const t2 = `X\nY\n${t1}`;
    writeFileSync(f.file, t1);
    const source = fileSourceAt(f.root, f.config.dataDir);
    const realGit = gitCalls.git;
    const realGitLines = gitCalls.gitLines;
    let captured = false;
    let mapped = 0;
    const restoreT1 = (args: string[]) => {
      if (
        (args[0] === "diff-index" && args.includes("-U0")) ||
        (args[0] === "diff" && args.includes("--no-index"))
      ) {
        expect(readFileSync(f.file, "utf8")).toBe(t2);
        mapped += 1;
        writeFileSync(f.file, t1);
      }
    };
    vi.spyOn(fileSources, "fileSourceAt").mockReturnValue(async (...args) => {
      const text = await source(...args);
      if (!captured && args[2] === "worktree") {
        captured = true;
        expect(text).toBe(t1);
        writeFileSync(f.file, t2);
      }
      return text;
    });
    vi.spyOn(gitCalls, "git").mockImplementation(async (cwd, args, overrides) => {
      const raw = await realGit(cwd, args, overrides);
      restoreT1(args);
      return raw;
    });
    vi.spyOn(gitCalls, "gitLines").mockImplementation(async (cwd, args, take, overrides) => {
      const result = await realGitLines(cwd, args, take, overrides);
      restoreT1(args);
      return result;
    });
    let readyLine: number | null = null;
    let readyPatch = "";
    try {
      await rescanRepository(f.config, "work", "repo", ({ cache }) => {
        readyLine = JSON.parse(
          readFileSync(commentsPath(f.config.dataDir, "work"), "utf8"),
        ).comments.find((c: { id: string }) => c.id === f.comment.id).line;
        readyPatch = cache.repositories[0]?.files[0]?.patch ?? "";
      });
    } finally {
      vi.restoreAllMocks();
    }
    expect(captured).toBe(true);
    expect(mapped).toBe(1);
    expect(readFileSync(f.file, "utf8")).toBe(t1);
    expect(readyLine).toBe(2);
    expect((await get(f.config.dataDir, "work", f.comment.id)).line).toBe(2);
    expect(readyPatch).toContain("+D");
    expect(readyPatch).not.toContain("+X");
    expect((await readDiffCache(f.config.dataDir, "work"))?.repositories[0]?.files[0]?.patch).toBe(
      readyPatch,
    );
  });
});

it("keeps committed rename identity with a Git-quoted target path", async () => {
  const f = await fixture();
  const path = "quoted\tname.ts";
  f.git("mv", "a.ts", path);
  f.git("commit", "-qam", "quoted committed rename");
  expect(await refresh(f)).toMatchObject({ path, line: 2, status: "open" });
});

it("cleans captured mapping scratch on a Git failure without changing the saved comment", async () => {
  const f = await fixture();
  const review = await readReview(f.config.dataDir, "work");
  const before = await readDiffCache(f.config.dataDir, "work");
  writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
  const after = (await scanReview(f.config, review.base)).cache;
  vi.spyOn(gitCalls, "gitLines").mockRejectedValueOnce(new Error("captured mapping Git failed"));
  try {
    await expect(
      reconcileAnchors(f.config, "work", review, after.repositories, before),
    ).rejects.toThrow("captured mapping Git failed");
  } finally {
    vi.restoreAllMocks();
  }
  expect(
    readdirSync(join(f.config.dataDir, "index")).filter((name) => name.startsWith(".anchor-map-")),
  ).toEqual([]);
  expect(await get(f.config.dataDir, "work", f.comment.id)).toEqual(f.comment);
});

describe("second review regressions", () => {
  it("keeps expanded range lineage across a second refresh with duplicated spans", async () => {
    const f = await fixture();
    writeFileSync(f.file, "A\nTARGET\nB\nA\nTARGET\nB\n");
    f.git("add", "a.ts");
    f.git("commit", "-qm", "range identity source");
    await writeDiffCache(
      f.config.dataDir,
      "work",
      (await scanReview(f.config, { mode: "head" })).cache,
    );
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 1,
        endLine: 3,
        severity: "nit",
        body: "range lineage",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    expect(f.comment.anchor?.revision).toMatchObject({ line: 1, endLine: 3 });
    writeFileSync(f.file, "A\nX\nTARGET\nB\nA\nX\nTARGET\nB\n");
    const first = await refresh(f);
    expect(first).toMatchObject({ status: "open", line: 1, endLine: 4 });
    const second = await refresh(f);
    expect(second).toMatchObject({ status: "open", line: 1, endLine: 4 });
    expect(second.originalAnchor).toEqual(first.originalAnchor);
    expect(second.anchor?.revision?.content).toEqual(["A", "TARGET", "B"]);
    expect(second.anchor?.rangeContent).toEqual(["A", "X", "TARGET", "B"]);
  });

  it("skips a null safe read after a captured empty diff while preserving Ready and cache", async () => {
    const f = await fixture();
    writeFileSync(f.file, f.text);
    const source = fileSourceAt(f.root, f.config.dataDir);
    let reads = 0;
    vi.spyOn(fileSources, "fileSourceAt").mockReturnValue(async (repo, path, rev) => {
      if (rev === "worktree") {
        reads += 1;
        return null;
      }
      return source(repo, path, rev);
    });
    let readyStatus = "";
    let readyRepositories = -1;
    try {
      await rescanRepository(f.config, "work", "repo", ({ cache }) => {
        readyStatus = JSON.parse(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8"))
          .comments[0].status;
        readyRepositories = cache.repositories.length;
      });
    } finally {
      vi.restoreAllMocks();
    }
    expect(reads).toBe(1);
    expect(readFileSync(f.file, "utf8")).toBe(f.text);
    expect(readyStatus).toBe("open");
    expect(readyRepositories).toBe(0);
    const stored = await get(f.config.dataDir, "work", f.comment.id);
    expect(stored).toMatchObject({ status: "open", line: 2 });
    expect(stored.anchor).toEqual(f.comment.anchor);
    expect((await readDiffCache(f.config.dataDir, "work"))?.repositories).toEqual([]);
  });

  it("marks a captured committed deletion orphaned even when the HEAD diff is empty", async () => {
    const f = await fixture();
    f.git("rm", "-f", "a.ts");
    f.git("commit", "-qm", "committed deletion");
    expect(await refresh(f)).toMatchObject({
      status: "orphaned",
      line: 2,
      anchor: f.comment.anchor,
    });
  });
});

it("does not reread an empty captured repository after its target changes before reconciliation", async () => {
  const f = await fixture();
  writeFileSync(f.file, f.text);
  const realRead = repositoryReads.readRepositoryChange;
  let calls = 0;
  let capturedSha = "";
  let readyLine = 0;
  const watching = await startWatcher({
    config: f.config,
    scan: await scan(f.root, { roots: [f.root], depth: 2, exclude: [] }),
    bus: createEventBus(),
    activity: createActivityLog(),
    recursive: true,
    native: () => ({ polling: false, ready: Promise.resolve(), close: () => undefined }),
    onRescan: () => {
      readyLine = JSON.parse(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8"))
        .comments[0].line;
    },
  });
  vi.spyOn(repositoryReads, "readRepositoryChange").mockImplementation(async (...args) => {
    const change = await realRead(...args);
    calls += 1;
    if (calls === 1) {
      expect(change.files).toEqual([]);
      capturedSha = change.base?.sha ?? "";
      writeFileSync(f.file, `${prefix}${f.text}`);
    }
    return change;
  });
  try {
    await watching.refresh();
  } finally {
    await watching.close();
    vi.restoreAllMocks();
  }
  expect(capturedSha).toBe(f.git("rev-parse", "HEAD").trim());
  expect(readyLine).toBe(2);
  expect(calls).toBe(1);
  expect(await get(f.config.dataDir, "work", f.comment.id)).toMatchObject({
    line: 2,
    status: "open",
    anchor: f.comment.anchor,
  });
  expect((await readDiffCache(f.config.dataDir, "work"))?.repositories).toEqual([]);
});

it("CLI diff keeps an empty captured repository when its target changes before reconciliation", async () => {
  const f = await fixture();
  writeFileSync(f.file, f.text);
  const realRead = repositoryReads.readRepositoryChange;
  let calls = 0;
  let capturedSha = "";
  let out = "";
  let err = "";
  vi.spyOn(repositoryReads, "readRepositoryChange").mockImplementation(async (...args) => {
    const change = await realRead(...args);
    calls += 1;
    if (calls === 1) {
      expect(change.files).toEqual([]);
      capturedSha = change.base?.sha ?? "";
      writeFileSync(f.file, `${prefix}${f.text}`);
    }
    return change;
  });
  try {
    const code = await run(
      ["diff", "--root", f.root, "--data-dir", f.config.dataDir, "--review", "work", "--json"],
      { read: async () => null },
      {
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
        input: async () => "",
      },
    );
    expect(code, err).toBe(0);
  } finally {
    vi.restoreAllMocks();
  }
  expect(capturedSha).toBe(f.git("rev-parse", "HEAD").trim());
  expect(await get(f.config.dataDir, "work", f.comment.id)).toMatchObject({
    line: 2,
    status: "open",
    anchor: f.comment.anchor,
  });
  expect(JSON.parse(out).repositories).toEqual([]);
  expect(JSON.parse(out)).not.toHaveProperty("changes");
  expect(JSON.parse(out)).not.toHaveProperty("removed");
  expect((await readDiffCache(f.config.dataDir, "work"))?.repositories).toEqual([]);
  expect(calls).toBe(1);
});

describe("staged rename with a recreated source path", () => {
  it("follows a historical verified comment to the staged rename instead of the recreated copy", async () => {
    const f = await fixture();
    expect(f.comment.anchor?.revision?.path).toBe("a.ts");
    f.git("mv", "a.ts", "b.ts");
    writeFileSync(f.file, f.text);
    const captured = await scanReview(f.config, { mode: "head" });
    expect(
      captured.cache.repositories[0]?.files.map(({ path, oldPath, status }) => ({
        path,
        oldPath,
        status,
      })),
    ).toEqual([
      { path: "a.ts", oldPath: null, status: "added" },
      { path: "b.ts", oldPath: "a.ts", status: "renamed" },
    ]);
    expect(await refresh(f)).toMatchObject({
      path: "b.ts",
      line: 2,
      status: "open",
      originalAnchor: { path: "a.ts", line: 2 },
    });
  });

  it("keeps a new comment on the recreated added path after a staged rename", async () => {
    const f = await fixture();
    f.git("mv", "a.ts", "b.ts");
    writeFileSync(f.file, f.text);
    const captured = await scanReview(f.config, { mode: "head" });
    expect(
      captured.cache.repositories[0]?.files.map(({ path, oldPath, status }) => ({
        path,
        oldPath,
        status,
      })),
    ).toEqual([
      { path: "a.ts", oldPath: null, status: "added" },
      { path: "b.ts", oldPath: "a.ts", status: "renamed" },
    ]);
    await writeDiffCache(f.config.dataDir, "work", captured.cache);
    f.comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path: "a.ts",
        line: 2,
        severity: "nit",
        body: "new copy comment",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    f.git("commit", "-qm", "commit staged rename without the copy");
    expect(f.git("ls-files", "--others", "--exclude-standard").trim()).toBe("a.ts");
    expect(await refresh(f)).toMatchObject({ path: "a.ts", line: 2, status: "open" });
    expect(f.comment.anchor).not.toHaveProperty("revision");
  });

  it.each(["scope", "exclude"])(
    "keeps the historical anchor orphaned when its staged rename target is filtered by %s",
    async (filter) => {
      const f = await fixture();
      if (filter === "scope") {
        await updateSession(f.config.dataDir, "work", (draft) => {
          draft.review.scope = [{ repo: "repo", paths: ["a.ts"] }];
        });
      } else f.config.exclude = ["b.ts"];
      f.git("mv", "a.ts", "b.ts");
      writeFileSync(f.file, f.text);
      expect(await refresh(f)).toMatchObject({
        path: "a.ts",
        line: 2,
        status: "orphaned",
        anchor: f.comment.anchor,
      });
      expect(await list(f.config.dataDir, "work", { status: "all" })).toHaveLength(1);
      expect((await createReviewService(f.config).document("work")).warnings).toContainEqual({
        path: "repo",
        message: "1 comments lost their anchor in repo",
      });
    },
  );
});

it.each(["recreated source", "ordinary addition"])(
  "reanchors edits in a new added file before committing: %s",
  async (kind) => {
    const f = await fixture();
    const head = f.git("rev-parse", "HEAD").trim();
    if (kind === "recreated source") f.git("mv", "a.ts", "b.ts");
    const path = kind === "recreated source" ? "a.ts" : "fresh.ts";
    const file = join(f.repo, path);
    writeFileSync(file, f.text);
    const captured = await scanReview(f.config, { mode: "head" });
    if (kind === "recreated source") {
      expect(
        captured.cache.repositories[0]?.files.map(({ path, oldPath, status }) => ({
          path,
          oldPath,
          status,
        })),
      ).toEqual([
        { path: "a.ts", oldPath: null, status: "added" },
        { path: "b.ts", oldPath: "a.ts", status: "renamed" },
      ]);
    } else {
      expect(captured.cache.repositories[0]?.files.find((one) => one.path === path)).toMatchObject({
        path: "fresh.ts",
        oldPath: null,
        status: "added",
      });
    }
    await writeDiffCache(f.config.dataDir, "work", captured.cache);
    const comment = await addComment(
      f.config.dataDir,
      "work",
      {
        repo: "repo",
        path,
        line: 2,
        severity: "nit",
        body: "new added file anchor",
        author: "human",
        role: "human",
      },
      { source: fileSourceAt(f.root, f.config.dataDir) },
    );
    expect(comment.anchor).not.toHaveProperty("revision");
    writeFileSync(file, `${prefix}${f.text}`);
    await rescanRepository(f.config, "work", "repo");
    const stored = await get(f.config.dataDir, "work", comment.id);
    const current = (await readDiffCache(f.config.dataDir, "work"))?.repositories[0]?.files.find(
      (one) => one.path === path,
    );
    expect(current?.status).toBe("added");
    expect(
      current?.hunks.flatMap((hunk) => hunk.lines).find((line) => line.newLine === 7)?.content,
    ).toBe("const anchor = 42;");
    expect(f.git("rev-parse", "HEAD").trim()).toBe(head);
    expect(stored).toMatchObject({ path, line: 7, status: "open" });
    expect(stored.anchor).not.toHaveProperty("revision");
    expect(stored.originalAnchor).toMatchObject({ path, line: 2, anchor: comment.anchor });
  },
);

describe("bounded anchor reconciliation", () => {
  function barrier() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  async function legacyFiles(count: number) {
    const f = await fixture();
    const anchor = structuredClone(f.comment.anchor);
    if (anchor === null) throw new Error("fixture anchor missing");
    delete anchor.revision;
    const paths = Array.from({ length: count }, (_, index) => `parallel-${index}.ts`);
    for (const path of paths) writeFileSync(join(f.repo, path), `${prefix}${f.text}`);
    await updateComments(f.config.dataDir, "work", (comments) => {
      comments.splice(
        0,
        comments.length,
        ...paths.map((path, index) => ({
          ...f.comment,
          id: `c_p${String(index).padStart(5, "0")}`,
          path,
          anchor: structuredClone(anchor),
        })),
      );
    });
    const review = await readReview(f.config.dataDir, "work");
    const before = await readDiffCache(f.config.dataDir, "work");
    const after = (await scanReview(f.config, review.base)).cache;
    return { ...f, paths, review, before, after };
  }

  it.each([2, 10])("admits independent reads together and bounds %i comments", async (count) => {
    const f = await legacyFiles(count);
    const entered = barrier();
    const held = barrier();
    const source = fileSourceAt(f.root, f.config.dataDir);
    let admitted = 0;
    let active = 0;
    let peak = 0;
    const pending = reconcileAnchors(f.config, "work", f.review, f.after.repositories, f.before, {
      source: async (...args) => {
        if (args[2] !== "worktree") return source(...args);
        admitted += 1;
        active += 1;
        peak = Math.max(peak, active);
        entered.release();
        try {
          await held.promise;
          return await source(...args);
        } finally {
          active -= 1;
        }
      },
    });
    try {
      await entered.promise;
      expect(admitted).toBe(Math.min(count, SCAN_CONCURRENCY));
      expect(active).toBe(admitted);
    } finally {
      held.release();
      await pending;
    }
    expect(admitted).toBe(count);
    expect(peak).toBeLessThanOrEqual(SCAN_CONCURRENCY);
    expect(active).toBe(0);
    const saved = await readComments(f.config.dataDir, "work");
    expect(saved.map((comment) => comment.path)).toEqual(f.paths);
    expect(saved.every((comment) => comment.line === 7 && comment.status === "open")).toBe(true);
  });

  it("drains held reads and preserves input-ordered errors without Ready or partial persistence", async () => {
    const f = await legacyFiles(3);
    const first = new Error("first comment source failed");
    const second = new Error("second comment source failed");
    const entered = barrier();
    const failFirst = barrier();
    const finishLast = barrier();
    const lastFinished = barrier();
    let lastStarted = false;
    const source = fileSourceAt(f.root, f.config.dataDir);
    const original = readFileSync(commentsPath(f.config.dataDir, "work"), "utf8");
    const cachePath = join(f.config.dataDir, "reviews", "work", "diff.json");
    const originalCache = readFileSync(cachePath, "utf8");
    const admitted: string[] = [];
    let ready = 0;
    let finished = false;
    vi.spyOn(fileSources, "fileSourceAt").mockReturnValue(async (...args) => {
      if (args[2] !== "worktree") return source(...args);
      admitted.push(args[1]);
      entered.release();
      if (args[1] === f.paths[0]) {
        await failFirst.promise;
        throw first;
      }
      if (args[1] === f.paths[1]) throw second;
      lastStarted = true;
      try {
        await finishLast.promise;
        return await source(...args);
      } finally {
        lastFinished.release();
      }
    });
    const pending = rescanRepository(f.config, "work", "repo", () => {
      ready += 1;
    }).then(
      () => {
        finished = true;
        return null;
      },
      (error: unknown) => {
        finished = true;
        return error;
      },
    );
    try {
      await entered.promise;
      expect(admitted).toEqual(f.paths);
      failFirst.release();
      await readComments(f.config.dataDir, "work");
      expect(finished).toBe(false);
      expect(ready).toBe(0);
      expect(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8")).toBe(original);
    } finally {
      failFirst.release();
      finishLast.release();
      await pending;
      if (lastStarted) await lastFinished.promise;
      vi.restoreAllMocks();
    }
    expect(await pending).toBe(first);
    expect(ready).toBe(0);
    expect(readFileSync(commentsPath(f.config.dataDir, "work"), "utf8")).toBe(original);
    expect(readFileSync(cachePath, "utf8")).toBe(originalCache);
  });

  it("shares pending source, mapping and patch reads for comments on one captured span", async () => {
    const f = await fixture();
    await updateComments(f.config.dataDir, "work", (comments) => {
      comments.push({ ...structuredClone(f.comment), id: "c_shared", body: "a second thread" });
    });
    const review = await readReview(f.config.dataDir, "work");
    const before = await readDiffCache(f.config.dataDir, "work");
    writeFileSync(f.file, `${prefix}${f.text}const added = 4;\n`);
    const after = (await scanReview(f.config, review.base)).cache;
    const entered = barrier();
    const drivers = barrier();
    const originalDrivers = gitCalls.repositoryDrivers;
    vi.spyOn(gitCalls, "repositoryDrivers").mockImplementation(async (...args) => {
      entered.release();
      await drivers.promise;
      return originalDrivers(...args);
    });
    const patches = vi.spyOn(anchorMappings, "capturedAnchorPatch");
    const mappings = vi.spyOn(anchorMappings, "reverseAnchor");
    const source = fileSourceAt(f.root, f.config.dataDir);
    const reads = new Map<string, number>();
    const pending = reconcileAnchors(f.config, "work", review, after.repositories, before, {
      source: async (...args) => {
        const key = JSON.stringify(args);
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return source(...args);
      },
    });
    try {
      await entered.promise;
      drivers.release();
      await pending;
      expect(patches).toHaveBeenCalledTimes(1);
      expect(mappings).toHaveBeenCalledTimes(1);
      expect(reads.size).toBe(2);
      expect([...reads.values()]).toEqual([1, 1]);
      const saved = await readComments(f.config.dataDir, "work");
      expect(saved.map((comment) => [comment.id, comment.line, comment.status])).toEqual([
        [f.comment.id, 7, "open"],
        ["c_shared", 7, "open"],
      ]);
    } finally {
      drivers.release();
      await pending;
      vi.restoreAllMocks();
    }
  });
});
