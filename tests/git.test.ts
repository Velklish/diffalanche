import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitError } from "../src/core/git/errors.ts";
import { parseDiff, readRepositoryChange, scan } from "../src/core/index.ts";
import type { RepositoryChange } from "../src/core/types.ts";

const FIXTURES = [
  "repos/g/api",
  "repos/g/names",
  "repos/g/solo",
  "repos/g/hostile",
  "repos/g/env-a",
  "repos/g/env-b",
];

/** 2026-01-01, well before the index was written: what makes a tracked file stat-dirty. */
const AGED = new Date("2026-01-01T00:00:00Z");

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
let marks: string;
let writesBefore: Map<string, string>;
let writesAfter: Map<string, string>;

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

  // A repository whose own configuration names four programs, each writing a
  // file the assertions look for: what DA-61 reproduced against bare git.
  marks = join(root, "probe/marks");
  mkdirSync(marks, { recursive: true });
  for (const [name, body] of [
    ["fsmonitor", `touch "${join(marks, "fsmonitor")}"\nexit 1\n`],
    ["textconv", `touch "${join(marks, "textconv")}"\ncat "$1"\n`],
    ["clean", `touch "${join(marks, "clean")}"\ncat\n`],
    ["process", `touch "${join(marks, "process")}"\nexit 1\n`],
  ]) {
    const script = join(root, "probe", `${name}.sh`);
    writeFileSync(script, `#!/bin/sh\n${body}`);
    chmodSync(script, 0o755);
  }
  const hostile = join(root, "repos/g/hostile");
  mkdirSync(hostile, { recursive: true });
  git(hostile, ["init", "--quiet", "-b", "main"]);
  writeFileSync(join(hostile, "app.ts"), "one\n");
  writeFileSync(join(hostile, ".gitattributes"), "app.ts diff=pwn filter=pwn\n");
  commit(hostile, "base");
  writeFileSync(join(hostile, "app.ts"), "two\n");
  git(hostile, ["config", "core.fsmonitor", join(root, "probe/fsmonitor.sh")]);
  git(hostile, ["config", "diff.pwn.textconv", join(root, "probe/textconv.sh")]);
  git(hostile, ["config", "filter.pwn.clean", join(root, "probe/clean.sh")]);
  git(hostile, ["config", "filter.pwn.process", join(root, "probe/process.sh")]);
  // git-lfs sets this, and an emptied filter under it is fatal rather than skipped.
  git(hostile, ["config", "filter.pwn.required", "true"]);

  // Two repositories of one file each: which one a read answers with is the
  // whole assertion about `GIT_DIR` and `GIT_INDEX_FILE`.
  for (const name of ["env-a", "env-b"]) {
    const dir = join(root, "repos/g", name);
    mkdirSync(join(dir, "src"), { recursive: true });
    git(dir, ["init", "--quiet", "-b", "main"]);
    writeFileSync(join(dir, "src", `${name}.ts`), "one\n");
    commit(dir, "base");
    writeFileSync(join(dir, "src", `${name}.ts`), "two\n");
  }

  // Old enough that the index's cached stat no longer matches: only then does a
  // porcelain `git diff` refresh the index, and only then can the guard see it.
  for (const path of FIXTURES) {
    const repo = join(root, path);
    for (const tracked of git(repo, [...INERT, "ls-files"])
      .split("\n")
      .filter(Boolean)) {
      // A tracked name is not always a file on disk: `gone file.ts` is deleted.
      if (existsSync(join(repo, tracked))) utimesSync(join(repo, tracked), AGED, AGED);
    }
  }

  writesBefore = snapshot();
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** What the guard's own `status` needs to look at the hostile repository at all:
 * its filter is `required`, so an unpinned read of it is fatal rather than quiet. */
const INERT = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "filter.pwn.clean=",
  "-c",
  "filter.pwn.process=",
  "-c",
  "filter.pwn.required=",
];

/** Everything a write would move: the index byte for byte, HEAD and every ref, where `git status`
 * alone was blind to all three (DA-65, `docs/reference/02-git.md`). */
function snapshot(): Map<string, string> {
  return new Map(
    FIXTURES.map((path) => {
      const repo = join(root, path);
      const index = createHash("sha256")
        .update(readFileSync(join(repo, ".git/index")))
        .digest("hex");
      const head = git(repo, [...INERT, "rev-parse", "HEAD"]);
      const refs = git(repo, [...INERT, "for-each-ref"]);
      const status = git(repo, [...INERT, "--no-optional-locks", "status", "--porcelain"]);
      return [path, [index, head, refs, status].join("\n")];
    }),
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

describe("an untracked symbolic link", () => {
  const solo = () => join(root, "repos/g/solo");

  /** `unlinkSync`, not `rmSync`: the latter resolves the link, and a dangling one survives it. */
  async function withLink(name: string, target: string) {
    symlinkSync(target, join(solo(), name));
    try {
      return await read("repos/g/solo", { mode: "head" });
    } finally {
      unlinkSync(join(solo(), name));
    }
  }

  /** The entry the reader made of the link, as git records a tracked one: mode 120000. */
  function link(change: RepositoryChange, name: string) {
    const file = change.files.find((one) => one.path === name);
    return { status: file?.status, patch: file?.patch, omitted: file?.omitted };
  }

  it("is an addition of mode 120000 whose content is the target, never the target's content", async () => {
    const outside = join(root, "outside-the-repository.ts");
    writeFileSync(outside, "SECRET-CONTENT\n");
    const change = await withLink("loose.ts", outside);
    const one = link(change, "loose.ts");
    expect(one.status).toBe("added");
    expect(one.omitted).toBeNull();
    expect(one.patch).toContain("new file mode 120000");
    expect(one.patch).toContain(`+${outside}`);
    // The whole point: the file outside the repository is not in the review.
    expect(JSON.stringify(change)).not.toContain("SECRET-CONTENT");
    rmSync(outside);
  });

  it("is recorded the same way when it dangles or points at a directory", async () => {
    const dangling = await withLink("dangling.ts", join(solo(), "nowhere.ts"));
    expect(link(dangling, "dangling.ts").patch).toContain("new file mode 120000");
    expect(dangling.warnings).toEqual([]);
    const directory = await withLink("dir-link", ".");
    expect(link(directory, "dir-link").patch).toContain("new file mode 120000");
    expect(directory.warnings).toEqual([]);
  });

  it("does not hang on a link to a character device", async () => {
    const change = await withLink("zero.ts", "/dev/zero");
    expect(link(change, "zero.ts").patch).toContain("+/dev/zero");
    expect(change.warnings).toEqual([]);
  }, 10_000);
});

describe("an untracked entry that is gone by the time the reader looks", () => {
  /** The one case still reaching the warning, driven by a shim that names a file nothing has:
   * `ls-files` said it was there and the reader did not find it (`docs/reference/02-git.md`). */
  it("costs a warning and the rest of the review, not the whole response", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-git-vanish-"));
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(dir, "git"),
      `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "--others" ]; then printf 'vanished.ts\\0'; exit 0; fi\n` +
        `done\nexec ${real} "$@"\n`,
    );
    chmodSync(join(dir, "git"), 0o755);
    const before = process.env.PATH;
    process.env.PATH = `${dir}:${before ?? ""}`;
    try {
      const change = await read("repos/g/solo", { mode: "head" });
      expect(change.warnings).toEqual(["untracked file vanished.ts cannot be read: ENOENT"]);
      expect(change.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    } finally {
      if (before === undefined) process.env.PATH = "";
      else process.env.PATH = before;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("an untracked entry that is not a regular file", () => {
  /** No verdict for the warning itself: nothing but a link reaches that branch, because
   * `ls-files --others` lists neither pipe nor socket nor device (`docs/reference/02-git.md`). */
  it("is not something ls-files reports, which is why the guard has no other test", async () => {
    const solo = join(root, "repos/g/solo");
    execFileSync("mkfifo", [join(solo, "pipe.fifo")]);
    try {
      const change = await read("repos/g/solo", { mode: "head" });
      expect(change.files.map((file) => file.path)).toEqual(["src/app.ts", "untracked.ts"]);
      expect(change.warnings).toEqual([]);
    } finally {
      rmSync(join(solo, "pipe.fifo"));
    }
  }, 10_000);
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

/** What the reader trusts a reviewed repository with, and the environment it was
 * started in with ([ADR-012](../docs/adr/adr-012-git-trust-model.md)). */
describe("the reader runs nothing the repository names", () => {
  it("reads a repository whose configuration names four programs, running none", async () => {
    const change = await read("repos/g/hostile", { mode: "head" });
    for (const name of ["fsmonitor", "textconv", "clean", "process"]) {
      expect({ name, ran: existsSync(join(marks, name)) }).toEqual({ name, ran: false });
    }
    // The diff is still the file's own content, not the program's output.
    expect(change.files.map((file) => file.path)).toEqual(["app.ts"]);
    expect(change.files[0]?.patch).toContain("+two");
  });
});

describe("what a failed git call is", () => {
  it("tells the four shapes apart by what Node reports, not by which helper ran it", () => {
    const spawn = gitError("diff", { code: "ENOENT", errno: -2, syscall: "spawn git" });
    expect(spawn).toMatchObject({ failure: "not-started", exit: null, repositoryFault: false });
    expect(spawn.message).toBe("git could not be started: ENOENT");

    const exited = gitError("diff-index", { code: 128, stderr: "fatal: unable to read ce01362\n" });
    expect(exited).toMatchObject({ failure: "exited", exit: 128, repositoryFault: true });
    expect(exited.message).toBe("git diff-index exited 128: unable to read ce01362");

    const killed = gitError("diff-index", { code: null, signal: "SIGKILL", killed: true });
    expect(killed).toMatchObject({ failure: "killed", exit: null, repositoryFault: false });

    const big = gitError("diff-index", { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
    expect(big).toMatchObject({ failure: "too-large", exit: null, repositoryFault: true });
  });

  it("does not read a spawn failure as an answer", async () => {
    const before = process.env.PATH;
    // A directory with no git in it, not an empty `PATH`: Bun falls back to a
    // default path when `PATH` is empty and finds git anyway (ADR-009).
    process.env.PATH = mkdtempSync(join(tmpdir(), "diffalanche-no-git-"));
    try {
      await expect(read("repos/g/solo", { mode: "head" })).rejects.toMatchObject({
        name: "GitError",
        failure: "not-started",
      });
    } finally {
      if (before === undefined) process.env.PATH = "";
      else process.env.PATH = before;
    }
  });

  it("keeps a repository git refuses to one line of the review", async () => {
    const broken = join(root, "repos/g/broken");
    mkdirSync(broken, { recursive: true });
    git(broken, ["init", "--quiet", "-b", "main"]);
    writeFileSync(join(broken, "app.ts"), "one\n");
    commit(broken, "base");
    writeFileSync(join(broken, "app.ts"), "two\n");
    // The blob HEAD needs, removed: refs still resolve and the diff then cannot be read.
    const blob = git(broken, [...INERT, "rev-parse", "HEAD:app.ts"]).trim();
    rmSync(join(broken, ".git/objects", blob.slice(0, 2), blob.slice(2)));

    const change = await read("repos/g/broken", { mode: "head" });
    expect(change.base).toBeNull();
    expect(change.files).toEqual([]);
    expect(change.warnings.join(" ")).toContain("exited 128");

    // And the healthy repository beside it still answers.
    const solo = await read("repos/g/solo", { mode: "head" });
    expect(solo.files.map((file) => file.path)).toEqual(["src/app.ts", "untracked.ts"]);
    rmSync(broken, { recursive: true, force: true });
  });
});

describe("a repository whose configuration cannot be read is not read", () => {
  /** A `git` first on `PATH` that refuses `config --list` and hands everything else over. */
  function shim(): string {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-git-refuse-"));
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    const script = join(dir, "git");
    writeFileSync(
      script,
      `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "--list" ]; then echo refused >&2; exit 7; fi\n` +
        `  if [ "$a" = "diff" ]; then echo "$@" >> "${join(dir, "calls.log")}"; fi\ndone\nexec ${real} "$@"\n`,
    );
    chmodSync(script, 0o755);
    writeFileSync(join(dir, "calls.log"), "");
    return dir;
  }

  it("answers with no base and a warning, and never reaches the diff", async () => {
    const dir = shim();
    const before = process.env.PATH;
    process.env.PATH = `${dir}:${before ?? ""}`;
    let change: RepositoryChange;
    try {
      change = await read("repos/g/solo", { mode: "head" });
    } finally {
      if (before === undefined) process.env.PATH = "";
      else process.env.PATH = before;
    }
    expect(change.base).toBeNull();
    expect(change.files).toEqual([]);
    expect(change.warnings).toContain("repository configuration could not be read");
    expect(readFileSync(join(dir, "calls.log"), "utf8")).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the reader ignores the git environment it inherits", () => {
  async function withEnv<T>(vars: Record<string, string>, body: () => Promise<T>): Promise<T> {
    const before = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
    Object.assign(process.env, vars);
    try {
      return await body();
    } finally {
      for (const [key, value] of before) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("reads what the repository says, not what injected configuration says", async () => {
    const names = await withEnv(
      { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "diff.renames", GIT_CONFIG_VALUE_0: "false" },
      () => read("repos/g/names", { mode: "head" }),
    );
    const renamed = names.files.find((file) => file.path === "new name.ts");
    expect(renamed).toMatchObject({ status: "renamed", oldPath: "old name.ts" });
  });

  it("reads the repository whose path it was given, not the one GIT_DIR names", async () => {
    const change = await withEnv({ GIT_DIR: join(root, "repos/g/env-b/.git") }, () =>
      read("repos/g/env-a", { mode: "head" }),
    );
    expect(change.files.map((file) => file.path)).toEqual(["src/env-a.ts"]);
  });

  it("reads the repository's own index, not the one GIT_INDEX_FILE names", async () => {
    const change = await withEnv({ GIT_INDEX_FILE: join(root, "repos/g/env-b/.git/index") }, () =>
      read("repos/g/env-a", { mode: "head" }),
    );
    expect(change.files.map((file) => file.path)).toEqual(["src/env-a.ts"]);
  });
});

describe("the reader writes nothing", () => {
  it("leaves the index, HEAD, the refs and the working tree of every fixture as it found them", async () => {
    const config = { roots: ["repos"], depth: 2, exclude: [] };
    const found = await scan(root, config);
    for (const spec of [
      { mode: "head" } as const,
      { mode: "branch" } as const,
      { mode: "ref", ref: "origin/main" } as const,
    ]) {
      await Promise.all(found.repositories.map((repo) => read(repo.path, spec)));
    }
    writesAfter = snapshot();
    expect(writesAfter).toEqual(writesBefore);
    // Eight repositories read in three base modes, five git processes each: the
    // default five seconds is the suite's, not this one's.
  }, 60_000);
});
