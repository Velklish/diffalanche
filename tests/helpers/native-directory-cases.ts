/** Shared native directory scenarios; the macOS/Bun suite runs each in its own runtime
 * (05-watcher.md, "What the unit tests hold"). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repositoryIgnore } from "../../src/core/watcher/index.ts";
import type { Ignore, TreeWatcher, TreeWatcherOptions } from "../../src/core/watcher/tree.ts";
import { perDirectory, watchTree } from "../../src/core/watcher/tree.ts";

const DIRS = process.platform === "linux" || process.platform === "darwin";
const NATIVE_NAMES = process.env.DIFFALANCHE_TEST_RUNTIME !== "bun";

type Tree = { tree: TreeWatcher; heard: string[]; fellBack: () => number };

function start(
  dir: string,
  ignore: Ignore = () => false,
  pollIntervalMs = 250,
  native: TreeWatcherOptions["native"] = DIRS ? perDirectory : undefined,
): Tree {
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
    ...(native === undefined ? {} : { native }),
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

export const nativeDirectoryCases: Record<string, (dir: string) => Promise<void>> = {
  "is watched when it is made after the start, with what was already in it": async (dir) => {
    const tree = start(dir);
    try {
      await arm(tree, dir);
      // Made and filled in one process: the file may be there before the directory's watch is.
      const from = tree.heard.length;
      sh(`mkdir -p "${dir}/made/deep" && printf x > "${dir}/made/deep/first.ts"`);
      await heardAfter(tree, from, "made/deep/first.ts");
      await write(tree, dir, "made/deep/later.ts");
      assert.equal(tree.fellBack(), 0);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  "reports what a new directory held before a name written after it": async (dir) => {
    const tree = start(dir);
    try {
      await arm(tree, dir);
      for (let round = 0; round < 5; round += 1) {
        const from = tree.heard.length;
        sh(`mkdir -p "${dir}/n${round}/deep" && printf x > "${dir}/n${round}/deep/f.ts"`);
        sh(`printf x > "${dir}/marker-${round}"`);
        await heardAfter(tree, from, `marker-${round}`);
        const after = tree.heard.slice(from);
        assert.ok(after.indexOf(`n${round}/deep/f.ts`) >= 0);
        assert.ok(after.indexOf(`n${round}/deep/f.ts`) < after.indexOf(`marker-${round}`));
      }
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  "reports a burst of thousands of names in one directory in linear time and memory": async (
    dir,
  ) => {
    mkdirSync(join(dir, "out"));
    const tree = start(dir);
    let sampling: ReturnType<typeof setInterval> | undefined;
    try {
      await arm(tree, dir);
      const count = 5_000;
      const heapBefore = process.memoryUsage().heapUsed;
      let heapPeak = heapBefore;
      sampling = setInterval(() => {
        heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      }, 20);
      const from = tree.heard.length;
      // Written while this process waits, so the kernel queues every event and they come in one loop.
      const writer = `const fs = require("fs"); for (let i = 0; i < ${count}; i++) fs.writeFileSync(${JSON.stringify(join(dir, "out"))} + "/f" + i, "");`;
      execFileSync(process.execPath, ["-e", writer]);
      // Reported in the order of the writes, so the marker comes after every name of the burst.
      await write(tree, dir, "marker-after-burst");
      clearInterval(sampling);
      const names = new Set(tree.heard.slice(from).filter((path) => path.startsWith("out/")));
      // Bun names one change per read of the descriptor, so only Node names every file.
      if (NATIVE_NAMES) assert.equal(names.size, count);
      else assert.ok(names.size > 0);
      // Linear: the names themselves are well under a megabyte; the quadratic copy was 1.4 GB.
      assert.ok(heapPeak - heapBefore < 200 * 1024 * 1024);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      clearInterval(sampling);
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  "is watched again when it is removed and made again under its name": async (dir) => {
    mkdirSync(join(dir, "dist"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      for (let round = 0; round < 3; round += 1) {
        sh(`rm -rf "${dir}/dist" && mkdir "${dir}/dist"`);
        await write(tree, dir, `dist/y-${round}.js`);
        await write(tree, dir, `dist/z-${round}.js`);
      }
      assert.equal(tree.fellBack(), 0);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  "is watched again when another is moved in over its name": async (dir) => {
    mkdirSync(join(dir, "dist"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      for (let round = 0; round < 3; round += 1) {
        sh(`mkdir "${dir}/next" && rm -rf "${dir}/dist" && mv "${dir}/next" "${dir}/dist"`);
        await write(tree, dir, `dist/y-${round}.js`);
        await write(tree, dir, `dist/z-${round}.js`);
      }
      assert.equal(tree.fellBack(), 0);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  "is watched again after a checkout removed it and made it again": async (dir) => {
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
      assert.equal(tree.fellBack(), 0);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  "is let go when it is removed, and the rest of the tree stays watched": async (dir) => {
    mkdirSync(join(dir, "gone", "deep"), { recursive: true });
    mkdirSync(join(dir, "kept"));
    const tree = start(dir);
    try {
      await arm(tree, dir);
      const from = tree.heard.length;
      rmSync(join(dir, "gone"), { recursive: true });
      await heardAfter(tree, from, "gone");
      await write(tree, dir, "kept/after.ts");
      assert.equal(tree.tree.polling(), false);
      assert.equal(tree.fellBack(), 0);
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          nativeFailure: {
            heard: tree.heard,
            polling: tree.tree.polling(),
            fellBack: tree.fellBack(),
          },
        })}\n`,
      );
      throw error;
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
