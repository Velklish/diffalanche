import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { run } from "../src/cli/run.ts";
import {
  findRepositories,
  mapWithLimit,
  refreshRepository,
  SCAN_CONCURRENCY,
  scanReview,
} from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { parseDiff, scan } from "../src/core/index.ts";
import { byCodePoint } from "../src/core/order.ts";
import type { DiffCache } from "../src/core/storage/index.ts";
import { readDiffCache, writeDiffCache } from "../src/core/storage/index.ts";
import type { BaseSpec, ScanWarning } from "../src/core/types.ts";
import { rescanRepository } from "../src/core/watcher/index.ts";
import { makeRoot, REPOS } from "./helpers/fixture-root.ts";

/** The bound counted in calls, not processes: this is where it holds whatever the machine is
 * doing, and `tests/scope-scan.test.ts` is the ceiling beside it (`docs/reference/02-git.md`). */
describe("mapWithLimit", () => {
  /** Runs `count` items through the pool and reports the most that were ever in flight at once. */
  async function peakOf(count: number, limit: number): Promise<{ peak: number; order: number[] }> {
    let live = 0;
    let peak = 0;
    const items = Array.from({ length: count }, (_, at) => at);
    const order = await mapWithLimit(items, limit, async (item) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((done) => setTimeout(done, 1));
      live -= 1;
      return item;
    });
    return { peak, order };
  }

  it("never has more than the limit in flight, and answers in the order it was given", async () => {
    const { peak, order } = await peakOf(40, 4);
    expect(peak).toBe(4);
    expect(order).toEqual(Array.from({ length: 40 }, (_, at) => at));
  });

  it("does not wait on a pool wider than the work", async () => {
    expect((await peakOf(3, SCAN_CONCURRENCY)).peak).toBe(3);
  });

  it("is sequential at width one", async () => {
    expect((await peakOf(6, 1)).peak).toBe(1);
  });
});

/** The change set of a root, the way the server reads it before it caches it. */
async function changeSet(root: string): Promise<DiffCache> {
  const config = await loadConfig({ root });
  const { cache } = await scanReview(config, { mode: "head" });
  return cache;
}

const SMALL = PROFILES.small;

const REPO = "repos/core/cargos-api";
const STAGED_MARK = "// staged edit, added by the test";

let root: string;
let bundle: DiffCache;
let stagedBundle: DiffCache;
let statusBefore: string;
let statusAfterScan: string;
let statusStaged: string;
let statusAfterStagedScan: string;
let stagedEditPath: string;

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function status(repo: string): string {
  return git(repo, ["status", "--porcelain"]);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-change-set-"));
  generate({ out: root, seed: 7, profile: SMALL });
  const repo = join(root, REPO);

  statusBefore = status(repo);
  bundle = await changeSet(root);
  statusAfterScan = status(repo);

  // The change set is the working tree against HEAD, so a staged change belongs
  // to it. Staging happens here, in the test's own fixture — never in the reader.
  writeFileSync(join(repo, "staged-new.ts"), "export const staged = 1;\n");
  git(repo, ["add", "staged-new.ts"]);
  // A TypeScript file, so the appended marker is a comment and not, say, a
  // broken line in .gitmodules, which git reads as configuration.
  stagedEditPath = git(repo, ["ls-files"])
    .split("\n")
    .find((path) => path.endsWith(".ts")) as string;
  appendFileSync(join(repo, stagedEditPath), `${STAGED_MARK}\n`);
  git(repo, ["add", stagedEditPath]);

  statusStaged = status(repo);
  stagedBundle = await changeSet(root);
  statusAfterStagedScan = status(repo);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("change set", () => {
  it("reads the whole synthetic review, repository by repository", () => {
    expect(bundle.totals.repositories).toBe(SMALL.repos);
    expect(bundle.totals.files).toBe(SMALL.files);
    expect(bundle.totals.lines).toBe(SMALL.lines);
  });

  it("lists the sibling worktree but not the nested submodule", async () => {
    const found = await scan(root, { roots: ["repos"], depth: 2, exclude: [] });
    const paths = found.repositories.map((repo) => repo.path);
    expect(paths).toContain("repos/core/cargos-api-worktree");
    expect(paths.some((path) => path.includes("vendor/lib"))).toBe(false);
    // The worktree is clean, so it carries no changes and the review omits it.
    expect(bundle.repositories.map((repo) => repo.path)).not.toContain(
      "repos/core/cargos-api-worktree",
    );
  });

  it("shows an untracked file as an addition", () => {
    const added = bundle.repositories.flatMap((repo) =>
      repo.files.filter((file) => file.status === "added"),
    );
    expect(added).toHaveLength(SMALL.repos);
    for (const file of added) {
      expect(file.deletions).toBe(0);
      expect(file.patch).toContain("--- /dev/null");
    }
  });

  it("takes staged changes: the base is HEAD, not the index", () => {
    const repo = stagedBundle.repositories.find((one) => one.path === REPO);
    const staged = repo?.files.find((file) => file.path === "staged-new.ts");
    expect(staged).toMatchObject({ status: "added", additions: 1, deletions: 0 });
    // Listed once: a staged new file comes from the diff, not from the untracked list.
    expect(repo?.files.filter((file) => file.path === "staged-new.ts")).toHaveLength(1);

    const edited = repo?.files.find((file) => file.path === stagedEditPath);
    expect(edited?.patch).toContain(STAGED_MARK);
  });

  it("carries the structured hunks, which is what diff.json stores", () => {
    // The cache is the only source that has them: anchor capture reads them
    // there, and the review response drops them (`tests/server.test.ts`).
    const files = bundle.repositories.flatMap((repo) => repo.files);
    expect(files.some((file) => file.hunks.length > 0)).toBe(true);
    // The counts still come out, and they are what the totals are built from.
    expect(files.some((file) => file.additions + file.deletions > 0)).toBe(true);
  });

  it("leaves the repository untouched: the tool only reads git", () => {
    expect(statusAfterScan).toBe(statusBefore);
    expect(statusAfterStagedScan).toBe(statusStaged);
  });
});

describe("refreshing one repository", () => {
  it("does not lose the patch of another one written at the same moment", async () => {
    const fixture = mkdtempSync(join(tmpdir(), "diffalanche-refresh-"));
    try {
      generate({ out: fixture, seed: 3, profile: SMALL });
      const config = await loadConfig({ root: fixture });
      const base: BaseSpec = { mode: "head" };
      await writeDiffCache(config.dataDir, "synth", (await scanReview(config, base)).cache);

      const repos = (await findRepositories(config)).filter((path) =>
        existsSync(join(fixture, path, ".git")),
      );
      const [first, second] = [repos[0] as string, repos[1] as string];
      writeFileSync(join(fixture, first, "one.ts"), "export const one = 1;\n");
      writeFileSync(join(fixture, second, "two.ts"), "export const two = 2;\n");

      // Both patch the same file. Without the session lock the second read
      // starts before the first write lands, and one of the two is overwritten.
      await Promise.all([
        refreshRepository(config, "synth", base, first),
        refreshRepository(config, "synth", base, second),
      ]);

      const cache = await readDiffCache(config.dataDir, "synth");
      const files = (path: string) =>
        cache?.repositories.find((one) => one.path === path)?.files.map((one) => one.path) ?? [];
      expect(files(first)).toContain("one.ts");
      expect(files(second)).toContain("two.ts");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 120_000);
});

/** The one patch both writers use: the CLI before it captures a line anchor, the watcher after an
 * edit. A linked worktree is the case, because its warning is the walk's and not the read's. */
describe("patching one repository into the cache", () => {
  const [ALPHA, BETA] = REPOS;
  const WORKTREE = `${ALPHA}-worktree`;
  const SESSION = "patched";
  let fixture: string;

  async function cli(...argv: string[]): Promise<number> {
    const quiet = { out: () => {}, err: () => {}, input: async () => "" };
    return run([...argv, "--root", fixture], { read: async () => null }, quiet);
  }

  async function cached(): Promise<DiffCache> {
    const config = await loadConfig({ root: fixture });
    return (await readDiffCache(config.dataDir, SESSION)) as DiffCache;
  }

  /** Sorted the way the cache promises: by path, then by message. */
  function sorted(warnings: ScanWarning[]): ScanWarning[] {
    return [...warnings].sort(
      (a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.message, b.message),
    );
  }

  beforeAll(async () => {
    fixture = makeRoot();
    execFileSync("git", ["worktree", "add", "-q", "--detach", `../alpha-worktree`, "HEAD"], {
      cwd: join(fixture, ALPHA),
      stdio: "ignore",
      env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
    });
    appendFileSync(join(fixture, WORKTREE, "file.txt"), "edited in the worktree\n");
    expect(await cli("review", "new", SESSION)).toBe(0);
    expect(await cli("diff", "--json")).toBe(0);
  }, 60_000);

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it("keeps the worktree warning through a line comment of the CLI", async () => {
    const warning = { path: WORKTREE, message: `worktree of ${ALPHA}` };
    expect((await cached()).warnings).toContainEqual(warning);
    expect((await cached()).rootWarnings).toContainEqual(warning);

    // Line 9 is the one the worktree appended; the fixture's own edit is not in this checkout.
    const argv = ["--path", "file.txt", "--line", "9", "--severity", "nit", "--body", "here"];
    expect(await cli("comment", "--repo", WORKTREE, ...argv)).toBe(0);

    expect((await cached()).warnings).toContainEqual(warning);
  }, 60_000);

  const writers: Record<string, (config: Config) => Promise<unknown>> = {
    cli: (config) => refreshRepository(config, SESSION, { mode: "head" }, BETA),
    watcher: (config) => rescanRepository(config, SESSION, BETA),
  };
  it.each(Object.keys(writers))(
    "writes the warnings sorted when the %s patches",
    async (writer) => {
      const config = await loadConfig({ root: fixture });
      const fresh = await cached();
      // Out of order on purpose, and without BETA's entry so the watcher's
      // short-circuit for an unchanged repository does not skip the write.
      const shuffled = [...fresh.warnings, { path: "repos/z", message: "b" }].reverse();
      await writeDiffCache(config.dataDir, SESSION, {
        ...fresh,
        repositories: fresh.repositories.filter((one) => one.path !== BETA),
        warnings: [{ path: "repos/z", message: "a" }, ...shuffled],
      });
      await writers[writer]?.(config);
      const { warnings } = await cached();
      expect(warnings).toContainEqual({ path: "repos/z", message: "a" });
      expect(warnings).toEqual(sorted(warnings));
    },
    60_000,
  );

  it.each(Object.keys(writers))(
    "scans instead of patching a cache written before its root warnings, when the %s writes",
    async (writer) => {
      const config = await loadConfig({ root: fixture });
      const { rootWarnings, ...old } = await cached();
      const warning = { path: WORKTREE, message: `worktree of ${ALPHA}` };
      expect(rootWarnings).toContainEqual(warning);
      // What a build before the field left after a line comment on the worktree.
      const warnings = old.warnings.filter((one) => one.path !== WORKTREE);
      await writeDiffCache(config.dataDir, SESSION, { ...old, warnings });
      await writers[writer]?.(config);
      expect((await cached()).rootWarnings).toContainEqual(warning);
      expect((await cached()).warnings).toContainEqual(warning);
    },
    60_000,
  );
});

describe("parseDiff", () => {
  const raw = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,3 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
    " const c = 4;",
    "diff --git a/src/b.ts b/src/b.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.ts",
    "@@ -0,0 +1,2 @@",
    "+export const x = 1;",
    "+export const y = 2;",
    "",
  ].join("\n");

  it("keeps a pure rename, which carries no hunks at all", () => {
    const rename = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "",
    ].join("\n");
    const { files } = parseDiff(rename);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      // Having no hunks is not the same as having no content to show.
      omitted: null,
    });
    expect(files[0]?.patch).toContain("rename to src/new.ts");
  });

  it("splits the output into one patch per file and counts the changed lines", () => {
    const { files, notes } = parseDiff(raw);
    expect(notes).toEqual([]);
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0]).toMatchObject({ status: "modified", additions: 1, deletions: 1 });
    expect(files[1]).toMatchObject({ status: "added", additions: 2, deletions: 0 });
    expect(files[0]?.patch).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(files[0]?.patch).toContain("@@ -1,3 +1,3 @@");
  });

  it("returns the half of a type change it could not list with the files, not into a sink", () => {
    const typeChange = [
      "diff --git a/thing.bin b/thing.bin",
      "deleted file mode 100644",
      "index 1111111..0000000",
      "Binary files a/thing.bin and /dev/null differ",
      "diff --git a/thing.bin b/thing.bin",
      "new file mode 120000",
      "index 0000000..2222222",
      "--- /dev/null",
      "+++ b/thing.bin",
      "@@ -0,0 +1 @@",
      "+/etc/hosts",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const { files, notes } = parseDiff(typeChange);
    expect(files.map((file) => file.path)).toEqual(["thing.bin"]);
    expect(notes).toEqual([
      "thing.bin changed type and its old side is binary: only the other side is listed",
    ]);
  });
});
