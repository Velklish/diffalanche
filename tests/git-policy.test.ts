import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import { refreshRepository, scanReview } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession } from "../src/core/domain/index.ts";
import { GIT_NULL } from "../src/core/git/run.ts";
import { scan } from "../src/core/scanner/index.ts";
import type { DiffCache, Scope } from "../src/core/storage/index.ts";
import { readDiffCache, writeDiffCache } from "../src/core/storage/index.ts";
import {
  createActivityLog,
  createEventBus,
  rescanRepository,
  startWatcher,
  type WatcherOptions,
} from "../src/core/watcher/index.ts";

const REPO = "repos/group/repo";
const BASE = { mode: "head" } as const;
const SESSION = "exclusions";

it("documents file exclusion in initial scans and live refreshes", () => {
  const scanner = readFileSync(new URL("../docs/reference/01-scanner.md", import.meta.url), "utf8");
  expect(scanner.includes("File exclusions apply to initial scans and live refreshes.")).toBe(true);
  expect(scanner.includes("`exclude` is applied to directories only")).toBe(false);
});

describe("Config.exclude file policy", () => {
  let root: string;
  let config: Config;

  function git(...args: string[]): void {
    execFileSync("git", args, {
      cwd: join(root, REPO),
      env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_NULL, GIT_CONFIG_SYSTEM: GIT_NULL },
      stdio: "ignore",
    });
  }

  function write(path: string, text: string): void {
    mkdirSync(join(root, REPO, path, ".."), { recursive: true });
    writeFileSync(join(root, REPO, path), text);
  }

  function paths(cache: DiffCache): string[] {
    return cache.repositories.flatMap((repo) => repo.files.map((file) => file.path)).sort();
  }

  async function cli(...args: string[]): Promise<DiffCache> {
    let output = "";
    let errors = "";
    const code = await run(
      [...args, "--root", root],
      { read: async () => null },
      {
        out: (text) => {
          output += text;
        },
        err: (text) => {
          errors += text;
        },
        input: async () => "",
      },
    );
    expect({ code, errors }).toEqual({ code: 0, errors: "" });
    return JSON.parse(output) as DiffCache;
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "diffalanche-exclude-"));
    write("package.lock", "old lock\n");
    write("src/app.ts", "old source\n");
    write("generated/out.ts", "old generated\n");
    write(".gitignore", "ignored.tmp\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "-qm",
      "initial",
    );
    write("package.lock", "new lock\n");
    write("src/app.ts", "new source\n");
    write("generated/out.ts", "new generated\n");
    write("nested/fresh.lock", "untracked lock\n");
    write("ignored.tmp", "ignored\n");
    config = {
      ...(await loadConfig({ root })),
      roots: [join(root, "repos")],
      exclude: ["**/*.lock", "generated/"],
    };
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(
      join(config.dataDir, "config.json"),
      JSON.stringify({ roots: ["repos"], exclude: config.exclude }),
    );
    await createSession(config.dataDir, SESSION, BASE);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each(
    (
      [
        null,
        [{ repo: REPO, paths: null }],
        [{ repo: REPO, paths: ["package.lock", "src/app.ts"] }],
      ] satisfies Scope[]
    ).map((scope) => [scope] as const),
  )("excludes tracked and untracked files in initial reads with scope %j", async (scope) => {
    const result = await scanReview(config, BASE, scope);
    expect(result.found).toEqual([REPO]);
    expect(paths(result.cache)).toEqual(["src/app.ts"]);
    expect(result.cache.totals).toEqual({ repositories: 1, files: 1, lines: 2 });
  });

  it("applies the policy to full, per-repository and named CLI reads", async () => {
    expect(paths(await cli("diff", "--json"))).toEqual(["src/app.ts"]);
    expect(paths(await cli("diff", "--json", "--repo", REPO))).toEqual(["src/app.ts"]);
    await createSession(config.dataDir, "other", BASE);
    expect(paths(await cli("diff", "--json", "--review", SESSION))).toEqual(["src/app.ts"]);
  });

  it.each(["cli", "watcher"])(
    "removes stale excluded files when %s refreshes one repository",
    async (writer) => {
      await writeDiffCache(
        config.dataDir,
        SESSION,
        (await scanReview({ ...config, exclude: [] }, BASE)).cache,
      );
      write("package.lock", "later lock\n");
      if (writer === "cli") await refreshRepository(config, SESSION, BASE, REPO);
      else await rescanRepository(config, SESSION, REPO);
      const cached = await readDiffCache(config.dataDir, SESSION);
      expect(cached).not.toBeNull();
      expect(paths(cached as DiffCache)).toEqual(["src/app.ts"]);
    },
  );

  it("matches renames by their current name and keeps Git-ignore semantics", async () => {
    write("package.lock", "old lock\n");
    write("src/app.ts", "old source\n");
    renameSync(join(root, REPO, "package.lock"), join(root, REPO, "visible.ts"));
    renameSync(join(root, REPO, "src/app.ts"), join(root, REPO, "hidden.lock"));
    git("add", "-A");
    const result = (await scanReview(config, BASE)).cache;
    expect(paths(result)).toEqual(["visible.ts"]);
    expect(result.repositories[0]?.files[0]).toMatchObject({
      status: "renamed",
      oldPath: "package.lock",
      path: "visible.ts",
    });
    expect(
      paths((await scanReview(config, BASE, [{ repo: REPO, paths: ["package.lock"] }])).cache),
    ).toEqual([]);
  });

  it("preserves anchored directory patterns and does not discover nested repositories", async () => {
    write("src/private/secret.ts", "hidden\n");
    write("other/private/visible.ts", "visible\n");
    write("nested-repo/file.ts", "nested\n");
    execFileSync("git", ["init", "-q", join(root, REPO, "nested-repo")]);
    const hidden = join(root, "repos/group/hidden");
    mkdirSync(hidden, { recursive: true });
    execFileSync("git", ["init", "-q", hidden]);
    config.exclude.push("src/private/", "repos/group/hidden/");
    const result = await scanReview(config, BASE);
    expect(result.found).toEqual([REPO]);
    expect(paths(result.cache)).toEqual(["other/private/visible.ts", "src/app.ts"]);
  });

  it("keeps excluded files absent after a subsequent live edit and refresh", async () => {
    const trees = new Map<string, Parameters<NonNullable<WatcherOptions["native"]>>[0]>();
    const failures: unknown[] = [];
    await writeDiffCache(config.dataDir, SESSION, (await scanReview(config, BASE)).cache);
    const watcher = await startWatcher({
      config,
      scan: await scan(root, { roots: config.roots, depth: config.depth, exclude: config.exclude }),
      bus: createEventBus(),
      activity: createActivityLog(),
      recursive: true,
      debounceMs: 1,
      native: (options) => {
        trees.set(options.dir, options);
        return { polling: false, ready: Promise.resolve(), close: () => undefined };
      },
      onError: (error) => failures.push(error),
    });
    try {
      const tree = trees.get(join(root, REPO));
      expect(tree).toBeDefined();
      expect(tree?.ignore("package.lock", "file")).toBe(true);
      write("package.lock", "live lock\n");
      write("src/app.ts", "live source\n");
      tree?.onChange("src/app.ts");
      await expect
        .poll(async () => {
          const cached = await readDiffCache(config.dataDir, SESSION);
          return cached?.repositories
            .flatMap((repo) => repo.files)
            .find((file) => file.path === "src/app.ts")?.patch;
        })
        .toContain("live source");
      expect(paths((await readDiffCache(config.dataDir, SESSION)) as DiffCache)).toEqual([
        "src/app.ts",
      ]);
      await watcher.refresh();
      expect(paths((await readDiffCache(config.dataDir, SESSION)) as DiffCache)).toEqual([
        "src/app.ts",
      ]);
      expect(failures).toEqual([]);
    } finally {
      await watcher.close();
    }
  });
});
