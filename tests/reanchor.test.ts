import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import { scanReview } from "../src/core/change-set.ts";
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
import { fileSourceAt } from "../src/core/git/browse.ts";
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
    { source: fileSourceAt(root) },
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
      { source: fileSourceAt(f.root) },
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
      { source: fileSourceAt(f.root) },
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
      { source: fileSourceAt(f.root) },
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
    expect(locateAnchor(saved, "unrelated();\n", [1])).toEqual({ kind: "orphaned" });
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
    const source = fileSourceAt(f.root);
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
      { source: fileSourceAt(f.root) },
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
      { source: fileSourceAt(f.root) },
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
    { source: fileSourceAt(f.root) },
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
    { source: fileSourceAt(f.root) },
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
  const source = fileSourceAt(f.root);
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
  await refresh(f);
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
  expect(moved).toMatchObject({ line: 10, status: "open" });
  expect(moved.anchor?.before.at(-1)).toBe("manual before");
});
