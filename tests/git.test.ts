import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDiff, readRepositoryChange, scan } from "../src/core/index.ts";
import type { RepositoryChange } from "../src/core/types.ts";

const BASE_LINES = Array.from(
  { length: 40 },
  (_, index) => `const line${index + 1} = ${index + 1};`,
);

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    },
  });
}

function commit(cwd: string, message: string): void {
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "--quiet", "-m", message]);
}

let root: string;
let statusBefore: Map<string, string>;
let statusAfter: Map<string, string>;

/**
 * A remote with a default branch, a clone with a feature branch ahead of it and
 * a clean working tree, and a repository with no remote at all: the three shapes
 * the base modes of `docs/SPEC.md` section 3, decision 4 behave differently on.
 */
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-git-"));
  mkdirSync(join(root, "repos/g"), { recursive: true });

  const seed = join(root, "seed");
  mkdirSync(join(seed, "src"), { recursive: true });
  git(root, ["init", "--bare", "--quiet", "-b", "main", "origin.git"]);
  git(seed, ["init", "--quiet", "-b", "main"]);
  writeFileSync(join(seed, "src/app.ts"), `${BASE_LINES.join("\n")}\n`);
  commit(seed, "base");
  git(seed, ["remote", "add", "origin", join(root, "origin.git")]);
  git(seed, ["push", "--quiet", "origin", "main"]);

  git(join(root, "repos/g"), ["clone", "--quiet", join(root, "origin.git"), "api"]);
  const api = join(root, "repos/g/api");
  git(api, ["checkout", "--quiet", "-b", "feature"]);
  // Three edits far enough apart that git prints three hunks.
  const edited = [...BASE_LINES];
  edited[2] = "const line3 = 300;";
  edited[19] = "const line20 = 2000;";
  edited[37] = "const line38 = 3800;";
  writeFileSync(join(api, "src/app.ts"), `${edited.join("\n")}\n`);
  writeFileSync(join(api, "src/added.ts"), "export const added = true;\n");
  commit(api, "feature work");

  // The default branch moves on after the branch point, so the merge base is no
  // longer the branch tip and the two can be told apart.
  writeFileSync(join(seed, "src/main-only.ts"), "export const mainOnly = true;\n");
  commit(seed, "work on main");
  git(seed, ["push", "--quiet", "origin", "main"]);
  git(api, ["fetch", "--quiet", "origin"]);

  const solo = join(root, "repos/g/solo");
  mkdirSync(join(solo, "src"), { recursive: true });
  git(solo, ["init", "--quiet", "-b", "main"]);
  writeFileSync(join(solo, "src/app.ts"), `${BASE_LINES.join("\n")}\n`);
  commit(solo, "base");
  writeFileSync(join(solo, "src/app.ts"), `${BASE_LINES.join("\n")}\nconst extra = 1;\n`);
  writeFileSync(join(solo, "untracked.ts"), "export const loose = 1;\n");

  // Every shape git does not write a path literally in: an unquoted name with a
  // space, which git pads with a tab, and a name outside ASCII, which it quotes.
  const names = join(root, "repos/g/names");
  mkdirSync(names, { recursive: true });
  git(names, ["init", "--quiet", "-b", "main"]);
  writeFileSync(join(names, "old name.ts"), `${BASE_LINES.join("\n")}\n`);
  writeFileSync(join(names, "sp ace.ts"), "one\n");
  writeFileSync(join(names, "файл.ts"), "one\n");
  writeFileSync(join(names, "gone file.ts"), "bye\n");
  writeFileSync(join(names, "mode me.sh"), "echo hi\n");
  // A directory whose name ends in ` b`, so that ` b/` appears inside the paths
  // themselves and the `diff --git` line cannot be split at the last one.
  mkdirSync(join(names, "x b"), { recursive: true });
  writeFileSync(join(names, "x b/z.sh"), "echo deep\n");
  // Content of its own: identical to `old name.ts` it would be interchangeable
  // with it, and git's rename detection would be free to pair them either way.
  writeFileSync(
    join(names, "moved.ts"),
    `${BASE_LINES.map((line) => line.replace("const", "export const")).join("\n")}\n`,
  );
  commit(names, "base");
  git(names, ["mv", "old name.ts", "new name.ts"]);
  git(names, ["mv", "moved.ts", "x b/y.ts"]);
  chmodSync(join(names, "x b/z.sh"), 0o755);
  // Untracked, and named the two ways `ls-files -z` can hand over but a patch
  // header cannot hold literally.
  writeFileSync(join(names, "tab\there.ts"), "tabbed\n");
  writeFileSync(join(names, "line\nbreak.ts"), "broken\n");
  writeFileSync(join(names, "sp ace.ts"), "two\n");
  writeFileSync(join(names, "файл.ts"), "two\n");
  rmSync(join(names, "gone file.ts"));
  chmodSync(join(names, "mode me.sh"), 0o755);

  statusBefore = statuses();
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function statuses(): Map<string, string> {
  return new Map(
    ["repos/g/api", "repos/g/names", "repos/g/solo"].map((path) => [
      path,
      git(join(root, path), ["status", "--porcelain"]),
    ]),
  );
}

function read(
  path: string,
  spec: Parameters<typeof readRepositoryChange>[2],
  options?: Parameters<typeof readRepositoryChange>[3],
) {
  return readRepositoryChange(root, path, spec, options);
}

describe("head mode", () => {
  let solo: RepositoryChange;

  beforeAll(async () => {
    solo = await read("repos/g/solo", { mode: "head" });
  });

  it("shows working-tree and untracked changes against HEAD", () => {
    expect(solo.base).toMatchObject({ mode: "head", ref: "HEAD" });
    expect(solo.base?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(solo.branch).toBe("main");
    expect(solo.files.map((file) => file.path)).toEqual(["src/app.ts", "untracked.ts"]);
    expect(solo.files[0]).toMatchObject({ status: "modified", additions: 1, deletions: 0 });
    expect(solo.files[1]).toMatchObject({ status: "added", additions: 1, deletions: 0 });
    expect(solo.warnings).toEqual([]);
  });

  it("shows nothing in a repository whose working tree is clean", async () => {
    const api = await read("repos/g/api", { mode: "head" });
    expect(api.files).toEqual([]);
    expect(api.branch).toBe("feature");
  });
});

describe("branch mode", () => {
  it("shows the commits a feature branch is ahead of the remote default branch by", async () => {
    const api = await read("repos/g/api", { mode: "branch" });
    expect(api.base).toMatchObject({ mode: "branch", ref: "origin/main" });
    expect(api.warnings).toEqual([]);
    expect(api.files.map((file) => file.path)).toEqual(["src/added.ts", "src/app.ts"]);

    const cwd = join(root, "repos/g/api");
    const mergeBase = git(cwd, ["merge-base", "HEAD", "origin/main"]).trim();
    const tip = git(cwd, ["rev-parse", "origin/main"]).trim();
    expect(api.base?.sha).toBe(mergeBase);
    // The base is the merge base, not the branch tip: `origin/main` has a commit
    // of its own since the branch point.
    expect(api.base?.sha).not.toBe(tip);
    // And that commit's file is not in the review — it is not this branch's work.
    expect(api.files.map((file) => file.path)).not.toContain("src/main-only.ts");
  });

  it("uses the branch the session names", async () => {
    const api = await read("repos/g/api", { mode: "branch", branch: "origin/main" });
    expect(api.base).toMatchObject({ mode: "branch", ref: "origin/main" });
    expect(api.warnings).toEqual([]);
  });

  it("falls back to the remote default branch with a warning when the named one is absent", async () => {
    const api = await read("repos/g/api", { mode: "branch", branch: "origin/develop" });
    expect(api.base).toMatchObject({ mode: "branch", ref: "origin/main" });
    expect(api.warnings).toEqual([
      "branch origin/develop does not resolve, using the remote default branch",
    ]);
    expect(api.files.map((file) => file.path)).toEqual(["src/added.ts", "src/app.ts"]);
  });

  it("behaves like head with a warning in a repository with no remote", async () => {
    const solo = await read("repos/g/solo", { mode: "branch" });
    expect(solo.base).toMatchObject({ mode: "head", ref: "HEAD" });
    expect(solo.warnings).toEqual(["no remote, reading the working tree against HEAD"]);
    expect(solo.files.map((file) => file.path)).toEqual(["src/app.ts", "untracked.ts"]);
  });
});

describe("ref mode", () => {
  it("reads the change set against a ref that resolves", async () => {
    const api = await read("repos/g/api", { mode: "ref", ref: "origin/main" });
    expect(api.base).toMatchObject({ mode: "ref", ref: "origin/main" });
    expect(api.base?.sha).toBe(git(join(root, "repos/g/api"), ["rev-parse", "origin/main"]).trim());
    // Against the tip rather than the merge base, the branch's own commit shows
    // up as a deletion. That difference is the whole point of the two modes.
    expect(api.files.map((file) => file.path)).toEqual([
      "src/added.ts",
      "src/app.ts",
      "src/main-only.ts",
    ]);
    expect(api.files.find((file) => file.path === "src/main-only.ts")?.status).toBe("deleted");
    expect(api.warnings).toEqual([]);
  });

  it("skips a repository where the ref does not resolve, and says so", async () => {
    const api = await read("repos/g/api", { mode: "ref", ref: "v9.9.9" });
    expect(api.base).toBeNull();
    expect(api.files).toEqual([]);
    expect(api.warnings).toEqual(["ref v9.9.9 does not resolve"]);
  });
});

describe("parsed hunks", () => {
  it("numbers the lines of three hunks as the files themselves are numbered", async () => {
    const api = await read("repos/g/api", { mode: "branch" });
    const file = api.files.find((one) => one.path === "src/app.ts");
    expect(file?.hunks).toHaveLength(3);

    const cwd = join(root, "repos/g/api");
    const oldLines = git(cwd, ["show", `${api.base?.sha}:src/app.ts`]).split("\n");
    const newLines = git(cwd, ["show", "HEAD:src/app.ts"]).split("\n");
    // The headers are git's own, and every number indexes the file it names.
    const headers = git(cwd, [
      "diff",
      api.base?.sha ?? "",
      "HEAD",
      "--no-color",
      "-U3",
      "--",
      "src/app.ts",
    ])
      .split("\n")
      .filter((line) => line.startsWith("@@"));
    expect(file?.hunks.map((hunk) => hunk.header)).toEqual(headers);

    for (const hunk of file?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.oldLine !== null) expect(oldLines[line.oldLine - 1]).toBe(line.content);
        if (line.newLine !== null) expect(newLines[line.newLine - 1]).toBe(line.content);
        expect(line.oldLine === null || line.newLine === null || line.type === "context").toBe(
          true,
        );
      }
    }
  });
});

describe("files listed without content", () => {
  it("lists a binary file and a file over the limit without a patch", async () => {
    const patch = [
      "diff --git a/img.png b/img.png",
      "index 1111111..2222222 100644",
      "Binary files a/img.png and b/img.png differ",
      "diff --git a/big.ts b/big.ts",
      "index 1111111..2222222 100644",
      "--- a/big.ts",
      "+++ b/big.ts",
      "@@ -1,2 +1,2 @@",
      "-one",
      "+two",
      " three",
      "",
    ].join("\n");
    const [binary, big] = parseDiff(patch, { maxFileBytes: 60 });
    expect(binary).toMatchObject({ path: "img.png", omitted: "binary", patch: "", hunks: [] });
    expect(big).toMatchObject({ path: "big.ts", omitted: "too-large", patch: "", hunks: [] });
    // The counts survive: the file list needs them even without the patch.
    expect(big).toMatchObject({ additions: 1, deletions: 1 });

    const [kept] = parseDiff(patch, { maxFileBytes: 1024 });
    expect(kept?.omitted).toBe("binary");
    expect(parseDiff(patch, { maxFileBytes: 1024 })[1]?.omitted).toBeNull();
  });

  it("keeps a file whose only change is its mode, which has no hunks either", () => {
    const [file] = parseDiff("diff --git a/x.sh b/x.sh\nold mode 100644\nnew mode 100755\n");
    expect(file).toMatchObject({ path: "x.sh", status: "modified", omitted: null });
    expect(file?.patch).toContain("new mode 100755");
  });

  it("lists an empty untracked file as an addition with content", async () => {
    const solo = join(root, "repos/g/solo");
    writeFileSync(join(solo, "empty.ts"), "");
    const change = await read("repos/g/solo", { mode: "head" });
    expect(change.files.find((file) => file.path === "empty.ts")).toMatchObject({
      status: "added",
      omitted: null,
      additions: 0,
      deletions: 0,
    });
    rmSync(join(solo, "empty.ts"));
  });

  it("lists an untracked file over the limit without opening it", async () => {
    const solo = join(root, "repos/g/solo");
    writeFileSync(join(solo, "big.ts"), `export const big = "${"x".repeat(200)}";\n`);
    try {
      const change = await read("repos/g/solo", { mode: "head" }, { maxFileBytes: 64 });
      expect(change.files.find((file) => file.path === "big.ts")).toMatchObject({
        status: "added",
        omitted: "too-large",
        patch: "",
        // Nothing was read, so there is nothing to count.
        additions: 0,
        deletions: 0,
      });
      // A small untracked file beside it still comes with its content.
      expect(change.files.find((file) => file.path === "untracked.ts")?.omitted).toBeNull();
    } finally {
      rmSync(join(solo, "big.ts"));
    }
  });

  it("lists an untracked binary file without content", async () => {
    const solo = join(root, "repos/g/solo");
    writeFileSync(join(solo, "blob.bin"), Buffer.from([0x00, 0x01, 0x02]));
    const change = await read("repos/g/solo", { mode: "head" });
    expect(change.files.find((file) => file.path === "blob.bin")).toMatchObject({
      status: "added",
      omitted: "binary",
      patch: "",
    });
    rmSync(join(solo, "blob.bin"));
  });
});

describe("an untracked entry that cannot be read", () => {
  it("costs a warning and the rest of the review, not the whole response", async () => {
    const solo = join(root, "repos/g/solo");
    symlinkSync(join(solo, "nowhere.ts"), join(solo, "dangling.ts"));
    try {
      const change = await read("repos/g/solo", { mode: "head" });
      expect(change.files.map((file) => file.path)).toEqual(["src/app.ts", "untracked.ts"]);
      expect(change.warnings).toEqual(["untracked file dangling.ts cannot be read: ENOENT"]);
    } finally {
      // `unlinkSync`, not `rmSync`: the latter resolves the link before removing
      // it and a dangling one leaves it in place.
      unlinkSync(join(solo, "dangling.ts"));
    }
  });
});

describe("paths git does not write literally", () => {
  // In the order the reader sorts them: by code point.
  const expected = [
    // A deletion: `--- a/gone file.ts<TAB>` with `+++ /dev/null` on the other side.
    { path: "gone file.ts", oldPath: null, status: "deleted", onDisk: false },
    // Untracked and holding a newline, which unquoted would tear the patch in two.
    { path: "line\nbreak.ts", oldPath: null, status: "added", onDisk: true },
    // Only a mode change, so the `diff --git` line is the only place the path is.
    { path: "mode me.sh", oldPath: null, status: "modified", onDisk: true },
    // A pure rename: no `---` or `+++` at all, only `rename from` and `rename to`.
    { path: "new name.ts", oldPath: "old name.ts", status: "renamed", onDisk: true },
    // A space on both sides, tab-padded by git.
    { path: "sp ace.ts", oldPath: null, status: "modified", onDisk: true },
    // Untracked and holding a tab: git quotes such a name, and so does the patch
    // the reader builds for it, or reading it back would cut it at the tab.
    { path: "tab\there.ts", oldPath: null, status: "added", onDisk: true },
    // Renamed into a directory ending in ` b`, so `diff --git a/moved.ts b/x b/y.ts`
    // cannot be split at its last ` b/`: only `rename to` says where it went.
    { path: "x b/y.ts", oldPath: "moved.ts", status: "renamed", onDisk: true },
    // Only a mode change, and ` b/` inside the path on both sides of the line.
    { path: "x b/z.sh", oldPath: null, status: "modified", onDisk: true },
    // Outside ASCII, so git C-quotes it with octal escapes for its UTF-8 bytes.
    { path: "файл.ts", oldPath: null, status: "modified", onDisk: true },
  ];

  it("reports the name the file has on disk", async () => {
    const change = await read("repos/g/names", { mode: "head" });
    expect(change.files.map((file) => file.path)).toEqual(expected.map((one) => one.path));
    for (const one of expected) {
      const file = change.files.find((each) => each.path === one.path);
      expect(file).toMatchObject({ oldPath: one.oldPath, status: one.status });
      expect(existsSync(join(root, "repos/g/names", one.path))).toBe(one.onDisk);
    }
    // The renamed file's old name is the name it had, not an escaped form of it.
    expect(existsSync(join(root, "repos/g/names", "old name.ts"))).toBe(false);
  });

  it("unquotes what git escapes, byte by byte", () => {
    const patch = [
      'diff --git "a/tab\\there.ts" "b/quote\\".ts"',
      "index 1111111..2222222 100644",
      '--- "a/tab\\there.ts"',
      '+++ "b/quote\\".ts"',
      "@@ -1 +1 @@",
      "-one",
      "+two",
      "",
    ].join("\n");
    const [file] = parseDiff(patch);
    expect(file?.path).toBe('quote".ts');
    expect(file?.status).toBe("modified");
  });
});

describe("the reader writes nothing", () => {
  it("leaves every fixture repository as it found it", async () => {
    const config = { roots: ["repos"], depth: 2, exclude: [] };
    const found = await scan(root, config);
    for (const spec of [
      { mode: "head" } as const,
      { mode: "branch" } as const,
      { mode: "ref", ref: "origin/main" } as const,
    ]) {
      await Promise.all(found.repositories.map((repo) => read(repo.path, spec)));
    }
    statusAfter = statuses();
    expect(statusAfter).toEqual(statusBefore);
  });
});
