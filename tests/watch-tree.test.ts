/** The watch per directory of `src/core/watcher/tree.ts` on its own: directories that come, go and
 * come back, one it may not read, and a watch the kernel refuses (05-watcher.md, "One watch…"). */
import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Ignore, TreeWatcher, TreeWatcherOptions } from "../src/core/watcher/tree.ts";
import { perDirectory, supportsRecursiveWatch, watchTree } from "../src/core/watcher/tree.ts";
import { nativeDirectoryCases } from "./helpers/native-directory-cases.ts";
import { needsTypeScript } from "./helpers/typescript.ts";

const run = promisify(execFile);
const unreadableTree = fileURLToPath(new URL("./helpers/unreadable-tree.ts", import.meta.url));
const nativeDirectoryChild = fileURLToPath(
  new URL("./helpers/native-directory-child.ts", import.meta.url),
);

/** How many more non-recursive watches `fs.watch` takes before it refuses the way inotify does. */
const refusal = vi.hoisted(() => ({ left: Number.POSITIVE_INFINITY }));

type Registration = { dir: string; closed: boolean; fire: (name: string | null) => void };
const replacement = vi.hoisted(() => ({
  enabled: false,
  beforeTake: null as ((dir: string) => void) | null,
  registrations: [] as Registration[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const { EventEmitter } = await import("node:events");
  const watch = ((...args: Parameters<typeof real.watch>) => {
    if (Number.isFinite(refusal.left)) {
      if (refusal.left <= 0) {
        throw Object.assign(new Error("ENOSPC: System limit for number of file watchers reached"), {
          code: "ENOSPC",
        });
      }
      refusal.left -= 1;
    }
    if (replacement.enabled) {
      const dir = String(args[0]);
      replacement.beforeTake?.(dir);
      const callback = (args as unknown[])[2] as (event: string, name: string | null) => void;
      class Registration extends EventEmitter {
        dir = dir;
        closed = false;
        close(): void {
          this.closed = true;
        }
        fire(name: string | null): void {
          if (!this.closed) callback("change", name);
        }
      }
      const registration = new Registration();
      replacement.registrations.push(registration);
      return registration;
    }
    return real.watch(...args);
  }) as typeof real.watch;
  return { ...real, default: { ...real, watch }, watch };
});

const DIRS = process.platform === "linux" || process.platform === "darwin";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-capability-"));
  try {
    await supportsRecursiveWatch(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

describe("a directory that comes, goes and comes back", () => {
  for (const [name, scenario] of Object.entries(nativeDirectoryCases)) {
    it(name, async () => {
      const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-native-"));
      try {
        if (process.platform === "darwin" && process.versions.bun !== undefined) {
          const { stdout } = await run(process.execPath, [nativeDirectoryChild, name, dir], {
            timeout: 60_000,
          });
          expect(JSON.parse(stdout)).toEqual({ ok: true });
        } else await scenario(dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

for (const phase of ["startup", "recreation"] as const) {
  it(`keeps a directory watched when identity changes during ${phase} registration`, async () => {
    const fixture = mkdtempSync(join(tmpdir(), "diffalanche-tree-register-replacement-"));
    const dir = join(fixture, "root");
    const child = join(dir, "dist");
    mkdirSync(child, { recursive: true });
    replacement.enabled = true;
    const replaceOnTake = (path: string): void => {
      if (path !== child) return;
      replacement.beforeTake = null;
      // Keep the old inode alive: the new directory must have a different identity.
      renameSync(child, join(fixture, "previous"));
      mkdirSync(child);
      writeFileSync(join(child, "y.js"), "before registration\n");
    };
    if (phase === "startup") replacement.beforeTake = replaceOnTake;
    const heard: string[] = [];
    let delivered: () => void = () => undefined;
    const changed = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let listed: () => void = () => undefined;
    const reconciled = new Promise<void>((resolve) => {
      listed = resolve;
    });
    let fallbacks = 0;
    const tree = perDirectory(
      {
        dir,
        ignore: () => false,
        onChange: (path) => {
          heard.push(path);
          if (path === "dist/z.js") delivered();
          if (path === "marker") listed();
        },
      },
      () => {
        fallbacks += 1;
      },
    );
    try {
      expect(tree).not.toBeNull();
      await tree?.ready;
      if (phase === "recreation") {
        renameSync(child, join(fixture, "initial"));
        mkdirSync(child);
        replacement.beforeTake = replaceOnTake;
        writeFileSync(join(dir, "marker"), "parent wake\n");
        const root = replacement.registrations.find((one) => one.dir === dir && !one.closed);
        expect(root).toBeDefined();
        // A coalesced parent wake carries no child name; reconciliation must renew its watch.
        root?.fire(null);
        await reconciled;
      }
      const active = replacement.registrations.filter((one) => one.dir === child && !one.closed);
      expect(active, "reconciliation must leave the replacement directory watched").toHaveLength(1);
      if (phase === "startup") expect(heard).toEqual([]);
      else expect(heard).toContain("dist/y.js");
      writeFileSync(join(child, "z.js"), "after ready\n");
      active[0]?.fire("z.js");
      await changed;
      expect(heard).toContain("dist/z.js");
      expect(tree?.polling).toBe(false);
      expect(fallbacks).toBe(0);
    } finally {
      tree?.close();
      replacement.enabled = false;
      replacement.beforeTake = null;
      const registrations = replacement.registrations.splice(0);
      rmSync(fixture, { recursive: true, force: true });
      expect(registrations.every((one) => one.closed)).toBe(true);
    }
  }, 5_000);
}

describe("a directory the watch may not read", () => {
  // Root reads a mode-000 directory anyway, so as root the tree runs with every capability dropped.
  it.skipIf(process.platform === "win32")(
    "is left out, and the rest of the tree stays watched",
    async (context) => {
      needsTypeScript(context);
      const root = process.getuid?.() === 0;
      if (root && !dropsCapabilities()) {
        context.skip(
          "running as root, and setpriv cannot drop the capabilities that read anything",
        );
      }
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
        const seen = JSON.parse(stdout) as {
          polling: boolean;
          fellBack: number;
          heard: string[];
          refused: string | null;
        };
        // The case is only a case if the process that watched could not read the directory.
        expect(seen.refused).toBe("EACCES");
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

/** Whether `setpriv` here leaves root unable to list a mode-000 directory: missing, or refused by
 * the container, it cannot. */
function dropsCapabilities(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "diffalanche-setpriv-"));
  chmodSync(probe, 0o000);
  try {
    execFileSync("setpriv", ["--inh-caps=-all", "--bounding-set=-all", "ls", probe], {
      stdio: "ignore",
    });
    return false;
  } catch (error) {
    // `ls` refused is exit status 2; a missing or refused `setpriv` is another failure.
    return (error as { status?: number }).status === 2;
  } finally {
    chmodSync(probe, 0o755);
    rmSync(probe, { recursive: true, force: true });
  }
}

describe("a watch the kernel refuses", () => {
  it.skipIf(!DIRS)("walks a root it cannot take, and hears it once the root is there", async () => {
    const parent = mkdtempSync(join(tmpdir(), "diffalanche-tree-noroot-"));
    const dir = join(parent, "root");
    const tree = start(dir, () => false, 20, perDirectory);
    try {
      await tree.tree.ready;
      expect(tree.tree.polling()).toBe(true);
      mkdirSync(dir);
      await write(tree, dir, "a.ts");
    } finally {
      tree.tree.close();
      rmSync(parent, { recursive: true, force: true });
    }
  });

  // `fs.watch` is refused past a count, the way inotify refuses once the user's watches run out.
  it.skipIf(!DIRS)("hands the tree to the walk when the start runs out of watches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-enospc-"));
    for (let one = 0; one < 6; one += 1) mkdirSync(join(dir, `d${one}`, "e"), { recursive: true });
    refusal.left = 3;
    const tree = start(dir, () => false, 20, perDirectory);
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

  it.skipIf(!DIRS)("hands the tree to the walk when a new directory runs it out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-enospc-late-"));
    mkdirSync(join(dir, "a"));
    const tree = start(dir, () => false, 20, perDirectory);
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

it("documents the native directory watches and the platform of lifecycle measurements", () => {
  const reference = readFileSync(
    new URL("../docs/reference/05-watcher.md", import.meta.url),
    "utf8",
  );
  expect(reference).toContain(
    "On macOS the lifecycle probe chooses recursive or per-directory native watching.",
  );
  expect(reference).not.toContain("nothing in it has gone\nquiet under Bun's runner");
  expect(reference).toContain(
    "An ignored temporary name can therefore still report the target replaced by",
  );
  expect(reference).toContain(
    "including dangling links. Stable links are not followed into target directories",
  );
  expect(reference).toContain(
    "and target content is not read, so changing an outside target alone produces no change.",
  );
  expect(reference).toContain("The explicitly named root may itself be a link.");
  expect(reference).toContain("A false Linux or macOS result still tries native directory watches");
  expect(reference).toContain(
    "components are checked with `lstat` before watching, listing and reporting their",
  );
  expect(reference).toContain(
    "When a concurrent path replacement is detected, the affected enumeration is\ndiscarded before its paths are published.",
  );
  expect(reference).toContain(
    "A replacement race can still cause\ninternal directory-name enumeration between checks.",
  );
  expect(reference).toContain(
    "These checks do not provide\nan atomic zero-enumeration guarantee; no native or OS layer closes that window.",
  );
  expect(reference).toContain(
    "A directory replaced between its identity read and watch registration is armed again",
  );
});

it("selects a native backend that reports a new-directory burst", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-selected-"));
  const heard: string[] = [];
  let fellBack = 0;
  try {
    await supportsRecursiveWatch(dir);
    const tree = watchTree({
      dir,
      ignore: () => false,
      onChange: (path) => heard.push(path),
      onFallback: () => {
        fellBack += 1;
      },
    });
    const observed = { tree, heard, fellBack: () => fellBack };
    try {
      await arm(observed, dir);
      const from = heard.length;
      sh(`mkdir -p "${dir}/made/deep" && printf x > "${dir}/made/deep/first.ts"`);
      await heardAfter(observed, from, "made/deep/first.ts");
      expect(tree.polling()).toBe(false);
      expect(fellBack).toBe(0);
    } finally {
      tree.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("a native save through an ignored temporary name", () => {
  it("reports the rename target three times without relying on the event name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-rename-"));
    writeFileSync(join(dir, "file.ts"), "before");
    const tree = start(dir, (path) => path.endsWith(".tmp"));
    try {
      await arm(tree, dir);
      for (let round = 0; round < 3; round += 1) {
        const from = tree.heard.length;
        sh(
          `printf 'save-${round}' > "${dir}/file.ts.tmp" && mv "${dir}/file.ts.tmp" "${dir}/file.ts"`,
        );
        await heardAfter(tree, from, "file.ts");
      }
      expect(tree.tree.polling()).toBe(false);
      expect(tree.fellBack()).toBe(0);
    } finally {
      tree.tree.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it("does not enter a watched directory replaced by a link, through an explicit root link", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "diffalanche-tree-link-replacement-"));
  const realRoot = join(fixture, "root");
  const dir = join(fixture, "named-root");
  const outside = join(fixture, "outside");
  mkdirSync(join(realRoot, "d", "sub"), { recursive: true });
  mkdirSync(join(outside, "sub"), { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "outside content");
  writeFileSync(join(outside, "sub", "secret.txt"), "outside child content");
  symlinkSync(realRoot, dir);
  const tree = start(dir, () => false, 250, perDirectory);
  try {
    await arm(tree, dir);
    await write(tree, dir, "d/sub/armed");
    const from = tree.heard.length;
    rmSync(join(dir, "d"), { recursive: true });
    symlinkSync(outside, join(dir, "d"));
    await write(tree, dir, "marker-replaced");
    expect(tree.heard.slice(from)).toContain("d");
    expect(tree.heard.slice(from).some((path) => path.includes("secret"))).toBe(false);

    writeFileSync(join(outside, "late-secret.txt"), "later outside content");
    writeFileSync(join(outside, "sub", "late-secret.txt"), "later child content");
    await write(tree, dir, "marker-later");
    expect(tree.heard.slice(from).some((path) => path.includes("secret"))).toBe(false);
    expect(tree.tree.polling()).toBe(false);
    expect(tree.fellBack()).toBe(0);
  } finally {
    tree.tree.close();
    rmSync(fixture, { recursive: true, force: true });
  }
});

describe("symbolic links in the polling tree", () => {
  it("reports link entries without following their targets, including dangling links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-tree-links-"));
    const outside = mkdtempSync(join(tmpdir(), "diffalanche-tree-target-"));
    const heard: string[] = [];
    const tree = watchTree({
      dir,
      ignore: () => false,
      recursive: false,
      pollIntervalMs: 10,
      onChange: (path) => heard.push(path),
    });
    const observed = { tree, heard, fellBack: () => 0 };
    let marker = 0;
    const barrier = async (): Promise<void> => {
      await write(observed, dir, `marker-${marker++}`);
    };
    try {
      await tree.ready;
      let from = heard.length;
      symlinkSync(outside, join(dir, "link"));
      await barrier();
      expect(heard.slice(from)).toContain("link");

      from = heard.length;
      writeFileSync(join(outside, "secret.txt"), "outside content");
      await barrier();
      await barrier();
      expect(heard.slice(from).filter((path) => !path.startsWith("marker-"))).toEqual([]);

      from = heard.length;
      symlinkSync("missing-target", join(dir, "next"));
      renameSync(join(dir, "next"), join(dir, "link"));
      await barrier();
      expect(heard.slice(from)).toContain("link");

      from = heard.length;
      unlinkSync(join(dir, "link"));
      await barrier();
      expect(heard.slice(from)).toContain("link");
      expect(heard.some((path) => path.includes("secret"))).toBe(false);
    } finally {
      tree.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
