/** The watch per directory of `src/core/watcher/tree.ts` on its own: directories that come, go and
 * come back, one it may not read, and a watch the kernel refuses (05-watcher.md, "One watch…"). */
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { repositoryIgnore } from "../src/core/watcher/index.ts";
import type { Ignore, TreeWatcher } from "../src/core/watcher/tree.ts";
import { watchTree } from "../src/core/watcher/tree.ts";
import { needsTypeScript } from "./helpers/typescript.ts";

const run = promisify(execFile);
const unreadableTree = fileURLToPath(new URL("./helpers/unreadable-tree.ts", import.meta.url));

/** How many more non-recursive watches `fs.watch` takes before it refuses the way inotify does. */
const refusal = vi.hoisted(() => ({ left: Number.POSITIVE_INFINITY }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const watch = ((...args: Parameters<typeof real.watch>) => {
    const options = args[1] as { recursive?: boolean } | undefined;
    if (options?.recursive !== true) {
      if (refusal.left <= 0) {
        throw Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), {
          code: "ENOSPC",
        });
      }
      refusal.left -= 1;
    }
    return real.watch(...args);
  }) as typeof real.watch;
  return { ...real, default: { ...real, watch }, watch };
});

const LINUX = process.platform === "linux";

type Tree = { tree: TreeWatcher; heard: string[]; fellBack: () => number };

function start(dir: string, ignore: Ignore = () => false, pollIntervalMs = 250): Tree {
  const heard: string[] = [];
  let fellBack = 0;
  const tree = watchTree({
    dir,
    ignore,
    onChange: (path) => heard.push(path),
    onFallback: () => {
      fellBack += 1;
    },
    pollIntervalMs,
  });
  return { tree, heard, fellBack: () => fellBack };
}

/** Waits for a path among what the tree reported since `from`. */
async function heardAfter(tree: Tree, from: number, path: string): Promise<void> {
  const deadline = performance.now() + 20_000;
  while (!tree.heard.slice(from).includes(path)) {
    if (performance.now() > deadline) throw new Error(`${path} was not heard`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/** Writes a file and waits for the tree to report it: the proof its directory is watched. */
async function write(tree: Tree, dir: string, path: string): Promise<void> {
  const from = tree.heard.length;
  writeFileSync(join(dir, path), `${path} ${Date.now()}\n`);
  await heardAfter(tree, from, path);
}

/** Proves the watch is delivering before anything is measured against it. */
async function arm(tree: Tree, dir: string): Promise<void> {
  await tree.tree.ready;
  const deadline = performance.now() + 20_000;
  for (let attempt = 0; !tree.heard.some((one) => one.startsWith("armed-")); attempt += 1) {
    if (performance.now() > deadline) throw new Error("the watch never armed");
    writeFileSync(join(dir, `armed-${attempt}`), "");
    await new Promise((done) => setTimeout(done, 50));
  }
}

function sh(script: string): void {
  execFileSync("sh", ["-c", script]);
}

describe("a directory that comes, goes and comes back", () => {
  it("is watched when it is made after the start, with what was already in it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-new-"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      // Made and filled in one process: the file may be there before the directory's watch is.
      const from = tree.heard.length;
      sh(`mkdir -p "${dir}/made/deep" && printf x > "${dir}/made/deep/first.ts"`);
      await heardAfter(tree, from, "made/deep/first.ts");
      await write(tree, dir, "made/deep/later.ts");
      expect(tree.fellBack()).toBe(0);
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // `settle` of the watcher's suite rests on this: a name reported means all written before it was.
  it("reports what a new directory held before a name written after it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-order-"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      for (let round = 0; round < 5; round += 1) {
        const from = tree.heard.length;
        sh(`mkdir -p "${dir}/n${round}/deep" && printf x > "${dir}/n${round}/deep/f.ts"`);
        sh(`printf x > "${dir}/marker-${round}"`);
        await heardAfter(tree, from, `marker-${round}`);
        const after = tree.heard.slice(from);
        expect(after.indexOf(`n${round}/deep/f.ts`)).toBeGreaterThanOrEqual(0);
        expect(after.indexOf(`n${round}/deep/f.ts`)).toBeLessThan(after.indexOf(`marker-${round}`));
      }
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ext4 hands the freed inode to the next `mkdir` at once, so an inode alone says it is the same.
  it("is watched again when it is removed and made again under its name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-again-"));
    mkdirSync(join(dir, "dist"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      for (let round = 0; round < 3; round += 1) {
        sh(`rm -rf "${dir}/dist" && mkdir "${dir}/dist"`);
        await write(tree, dir, `dist/y-${round}.js`);
        await write(tree, dir, `dist/z-${round}.js`);
      }
      expect(tree.fellBack()).toBe(0);
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Bun names the source of the rename alone, so the replaced name may never reach an event.
  it("is watched again when another is moved in over its name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-moved-"));
    mkdirSync(join(dir, "dist"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      for (let round = 0; round < 3; round += 1) {
        sh(`mkdir "${dir}/next" && rm -rf "${dir}/dist" && mv "${dir}/next" "${dir}/dist"`);
        await write(tree, dir, `dist/y-${round}.js`);
        await write(tree, dir, `dist/z-${round}.js`);
      }
      expect(tree.fellBack()).toBe(0);
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is watched again after a checkout removed it and made it again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-checkout-"));
    const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...identity, ...args]);
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "src", "gen"), { recursive: true });
    writeFileSync(join(dir, "src", "gen", "a.ts"), "a\n");
    git("add", ".");
    git("commit", "-q", "-m", "a");
    git("checkout", "-q", "-b", "other");
    git("rm", "-q", "src/gen/a.ts");
    mkdirSync(join(dir, "src", "gen"), { recursive: true });
    writeFileSync(join(dir, "src", "gen", "b.ts"), "b\n");
    git("add", ".");
    git("commit", "-q", "-m", "b");
    git("checkout", "-q", "main");
    const ignore = repositoryIgnore({ exclude: [], dataDir: join(dir, ".diffalanche") } as never, {
      path: ".",
      absolutePath: dir,
      kind: "repo",
    });
    const tree = start(dir, ignore);
    try {
      await arm(tree, dir);
      // Each switch removes `src/gen` with its one file and makes it again with the other.
      for (const [branch, file] of [
        ["other", "b.ts"],
        ["main", "a.ts"],
        ["other", "b.ts"],
      ] as const) {
        git("checkout", "-q", branch);
        await write(tree, dir, `src/gen/${file}`);
        git("checkout", "-q", "--", ".");
      }
      expect(tree.fellBack()).toBe(0);
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is let go when it is removed, and the rest of the tree stays watched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-gone-"));
    mkdirSync(join(dir, "gone", "deep"), { recursive: true });
    mkdirSync(join(dir, "kept"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      const from = tree.heard.length;
      rmSync(join(dir, "gone"), { recursive: true });
      await heardAfter(tree, from, "gone");
      await write(tree, dir, "kept/after.ts");
      expect(tree.tree.polling()).toBe(false);
      expect(tree.fellBack()).toBe(0);
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a directory the watch may not read", () => {
  // Root reads a mode-000 directory anyway, so as root the tree runs with every capability dropped.
  it.skipIf(process.platform === "win32")(
    "is left out, and the rest of the tree stays watched",
    async (context) => {
      needsTypeScript(context);
      const root = process.getuid?.() === 0;
      if (root && !hasSetpriv())
        context.skip("running as root without setpriv to drop capabilities");
      const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-unreadable-"));
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "volume", "data"), { recursive: true });
      chmodSync(join(dir, "volume"), 0o000);
      try {
        const command = [process.execPath, unreadableTree, dir];
        const drop = ["--inh-caps=-all", "--bounding-set=-all"];
        const { stdout } = root
          ? await run("setpriv", [...drop, ...command])
          : await run(command[0] as string, command.slice(1));
        const seen = JSON.parse(stdout) as { polling: boolean; fellBack: number; heard: string[] };
        expect(seen.heard.some((path) => path.startsWith("src/a-"))).toBe(true);
        expect(seen.polling).toBe(false);
        expect(seen.fellBack).toBe(0);
      } finally {
        chmodSync(join(dir, "volume"), 0o755);
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

function hasSetpriv(): boolean {
  try {
    execFileSync("setpriv", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("a watch the kernel refuses", () => {
  // `fs.watch` is refused past a count, the way inotify refuses once the user's watches run out.
  it.skipIf(!LINUX)("hands the tree to the walk when the start runs out of watches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-enospc-"));
    for (let one = 0; one < 6; one += 1) mkdirSync(join(dir, `d${one}`, "e"), { recursive: true });
    refusal.left = 3;
    const tree = start(dir, () => false, 20);
    try {
      const deadline = performance.now() + 20_000;
      while (tree.fellBack() === 0) {
        if (performance.now() > deadline) throw new Error("the walk never took over");
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(tree.tree.polling()).toBe(true);
      await write(tree, dir, "d5/e/walked.ts");
      expect(tree.fellBack()).toBe(1);
    } finally {
      refusal.left = Number.POSITIVE_INFINITY;
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!LINUX)("hands the tree to the walk when a new directory runs it out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-enospc-late-"));
    mkdirSync(join(dir, "a"));
    const tree = start(dir, () => false, 20);
    try {
      await arm(tree, dir);
      refusal.left = 1;
      mkdirSync(join(dir, "new", "x", "y"), { recursive: true });
      const deadline = performance.now() + 20_000;
      while (tree.fellBack() === 0) {
        if (performance.now() > deadline) throw new Error("the walk never took over");
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(tree.tree.polling()).toBe(true);
      await write(tree, dir, "new/x/y/walked.ts");
    } finally {
      refusal.left = Number.POSITIVE_INFINITY;
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
