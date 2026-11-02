/** The fixture barrier under permitted late delivery, against the real queue and cache (05-watcher.md). */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { scanReview } from "../src/core/change-set.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { scan } from "../src/core/index.ts";
import { readDiffCache, sessionDir, withLock, writeDiffCache } from "../src/core/storage/index.ts";
import type { WatcherOptions } from "../src/core/watcher/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../src/core/watcher/index.ts";
import { makeSettle } from "./helpers/watch-settle.ts";

it("finishes when a prior burst reads the probe before its own signal is delivered", async () => {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-settle-order-"));
  const trace: unknown[] = [];
  const callbacks = new Map<string, (path: string) => void>();
  const reported = new Set<string>();
  const pending: string[] = [];
  const events: { files: readonly string[]; at: number }[] = [];
  const signals: { files: readonly string[]; at: number }[] = [];
  let elapsed = 0;
  const now = () => performance.now() + elapsed;
  const until = async (done: () => boolean | Promise<boolean>): Promise<void> => {
    const deadline = performance.now() + 20_000;
    while (!(await done())) {
      if (performance.now() > deadline) throw new Error("controlled delivery never completed");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  let watcher: Awaited<ReturnType<typeof startWatcher>> | undefined;
  try {
    generate({ out: root, seed: 5, profile: PROFILES.small });
    const config = await loadConfig({ root });
    const found = await scan(config.root, {
      roots: config.roots,
      depth: config.depth,
      exclude: [],
    });
    const repo = found.repositories[0];
    const other = found.repositories.find((one) => one.path !== repo?.path && one.kind === "repo");
    expect(repo).toBeDefined();
    expect(other).toBeDefined();
    if (repo === undefined || other === undefined)
      throw new Error("fixture needs two repositories");
    mkdirSync(join(repo.absolutePath, ".git", "info"), { recursive: true });
    writeFileSync(join(repo.absolutePath, ".git", "info", "exclude"), "/marker-*\n");
    const { cache } = await scanReview(config, { mode: "head" });
    await writeDiffCache(config.dataDir, "synth", cache);
    const bus = createEventBus();
    bus.subscribe((event) => {
      if (event.type !== "diff-changed" || event.repo !== other.path) return;
      events.push({ files: event.files, at: now() });
      trace.push({ phase: "event", files: event.files });
    });
    const native: WatcherOptions["native"] = (options) => {
      callbacks.set(options.dir, options.onChange);
      return { polling: false, ready: Promise.resolve(), close: () => undefined };
    };
    watcher = await startWatcher({
      config,
      scan: found,
      bus,
      activity: createActivityLog(),
      recursive: true,
      native,
      onRepositoryChanged: (path, files) => {
        if (path !== other.path || files === undefined) return;
        signals.push({ files, at: now() });
        trace.push({ phase: "signal", files });
      },
    });
    const cached = async (file: string): Promise<boolean> => {
      const value = await readDiffCache(config.dataDir, "synth");
      return (
        value?.repositories
          .find((one) => one.path === other.path)
          ?.files.some((one) => one.path === file) ?? false
      );
    };
    let first = true;
    const settle = makeSettle({
      trees: () => [repo.absolutePath, config.dataDir],
      other: () => other.absolutePath,
      write: async (path, text) => {
        await writeFile(path, text);
        const file = basename(path);
        trace.push({ phase: "write", file });
        if (file.startsWith("marker-")) {
          reported.add(path);
          callbacks.get(dirname(path))?.(file);
          return;
        }
        pending.push(file);
        if (!first) return;
        first = false;
        // A prior burst is allowed to read a new path before its name is delivered.
        callbacks.get(other.absolutePath)?.("prior.ts");
        await until(() => events.length > 0);
        await until(() => cached(file));
        trace.push({ phase: "prior-committed", file });
      },
      reported: (dir, path) => reported.has(join(dir, path)),
      signals: (mark) => signals.filter((one) => one.at >= mark).map((one) => one.files),
      locked: () => existsSync(join(sessionDir(config.dataDir, "synth"), ".lock")),
      cached,
      overdue: () => undefined,
      clock: {
        now,
        pause: async () => {
          const file = pending.shift();
          if (file !== undefined) {
            const from = signals.length;
            trace.push({ phase: "deliver", file });
            callbacks.get(other.absolutePath)?.(file);
            await until(() => signals.slice(from).some((one) => one.files.includes(file)));
          }
          elapsed += 5_000;
        },
      },
    });
    await settle();
    expect(events.map((one) => one.files)).toEqual([["prior.ts"]]);
    expect(signals.map((one) => one.files)).toEqual([["prior.ts"], ["settle-2.ts"]]);
    expect(pending).toEqual([]);
    expect(await cached("settle-2.ts")).toBe(true);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ settleDeliveryTrace: trace })}\n`);
    throw error;
  } finally {
    await watcher?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("waits for both trees and the probe's own receipt before accepting an old cached probe", async () => {
  const reported = new Set<string>();
  const signals: string[][] = [];
  const writes: string[] = [];
  let now = 0;
  let predecessorFinished = false;
  let finished = false;
  let pauses = 0;
  const settle = makeSettle({
    trees: () => ["repo", "data"],
    other: () => "other",
    write: async (path) => {
      writes.push(path);
      if (basename(path).startsWith("settle-")) signals.push(["earlier.ts"]);
    },
    reported: (dir) => reported.has(dir),
    signals: () => signals,
    locked: () => false,
    cached: async () => {
      expect(predecessorFinished).toBe(true);
      return true;
    },
    overdue: () => undefined,
    clock: {
      now: () => now,
      pause: async () => {
        expect(finished).toBe(false);
        pauses += 1;
        now += 5;
        if (pauses <= 2) {
          expect(writes.some((path) => path.includes("settle-"))).toBe(false);
          reported.add(pauses === 1 ? "repo" : "data");
        } else {
          expect(writes.filter((path) => path.includes("settle-"))).toHaveLength(1);
          predecessorFinished = true;
          signals.push(["settle-2.ts"]);
        }
      },
    },
  });
  await settle().then(() => {
    finished = true;
  });
  expect(pauses).toBe(3);
  expect(finished).toBe(true);
});

it("waits for the real pending cache write even when an older cache already contains the probe", async () => {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-settle-cache-"));
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writing: Promise<void> | undefined;
  try {
    generate({ out: root, seed: 5, profile: PROFILES.small });
    const config = await loadConfig({ root });
    const file = "settle-2.ts";
    const repo = "repos/core/cargos-api";
    await writeFile(join(root, repo, file), "export const s = 2;\n");
    const { cache } = await scanReview(config, { mode: "head" });
    await writeDiffCache(config.dataDir, "synth", cache);
    const next = { ...cache, totals: { ...cache.totals, lines: cache.totals.lines + 1 } };
    const signals: string[][] = [];
    let returned = false;
    let pauses = 0;
    let receipt: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      receipt = resolve;
    });
    const settle = makeSettle({
      trees: () => [repo, config.dataDir],
      other: () => join(root, repo),
      write: async (path) => {
        if (!basename(path).startsWith("settle-")) return;
        writing = withLock(sessionDir(config.dataDir, "synth"), async (lock) => {
          // The real watcher reports changed entries while holding this lock, before writing.
          signals.push([file]);
          receipt();
          await held;
          await lock.assertHeld();
          await writeDiffCache(config.dataDir, "synth", next);
        });
        await ready;
      },
      reported: () => true,
      signals: () => signals,
      locked: () => existsSync(join(sessionDir(config.dataDir, "synth"), ".lock")),
      cached: async () => {
        const stored = await readDiffCache(config.dataDir, "synth");
        return (
          stored?.repositories
            .find((one) => one.path === repo)
            ?.files.some((one) => one.path === file) ?? false
        );
      },
      overdue: () => undefined,
      clock: {
        now: () => performance.now(),
        pause: async () => {
          expect(returned).toBe(false);
          expect(await readDiffCache(config.dataDir, "synth")).toEqual(cache);
          expect(existsSync(join(sessionDir(config.dataDir, "synth"), ".lock"))).toBe(true);
          pauses += 1;
          release();
          await writing;
        },
      },
    });
    await settle().then(() => {
      returned = true;
    });
    expect(pauses).toBe(1);
    expect(await readDiffCache(config.dataDir, "synth")).toEqual(next);
    expect(existsSync(join(sessionDir(config.dataDir, "synth"), ".lock"))).toBe(false);
  } finally {
    release();
    await writing;
    rmSync(root, { recursive: true, force: true });
  }
});

it("keeps one twenty-second deadline across tree delivery and the cache write", async () => {
  let now = 0;
  let reported = false;
  const signals: string[][] = [];
  let pauses = 0;
  const settle = makeSettle({
    trees: () => ["repo", "data"],
    other: () => "other",
    write: async (path) => {
      if (basename(path).startsWith("settle-")) signals.push([basename(path)]);
    },
    reported: () => reported,
    signals: () => signals,
    locked: () => true,
    cached: async () => false,
    overdue: () => undefined,
    clock: {
      now: () => now,
      pause: async () => {
        pauses += 1;
        if (pauses > 2) throw new Error("the deadline was reset between phases");
        now += pauses === 1 ? 15_000 : 6_000;
        reported = true;
      },
    },
  });
  await expect(settle()).rejects.toThrow("diff.json never had settle-2.ts");
  expect(now).toBe(21_000);
  expect(pauses).toBe(2);
});

it("retries a mixed burst only after that burst acknowledges its probe", async () => {
  let now = 0;
  const signals: string[][] = [];
  const written: string[] = [];
  const settle = makeSettle({
    trees: () => [],
    other: () => "other",
    write: async (path) => {
      written.push(basename(path));
      if (written.length === 2) {
        expect(signals).toEqual([["earlier.ts"], ["earlier.ts", "settle-2.ts"]]);
        now += 1;
        signals.push([basename(path)]);
      } else signals.push(["earlier.ts"]);
    },
    reported: () => true,
    signals: () => signals,
    locked: () => false,
    cached: async () => true,
    overdue: () => undefined,
    clock: {
      now: () => now,
      pause: async () => {
        expect(written).toEqual(["settle-2.ts"]);
        signals.push(["earlier.ts", "settle-2.ts"]);
        now += 1;
      },
    },
  });
  await settle();
  expect(written).toEqual(["settle-2.ts", "settle-3.ts"]);
});

it("documents the own-signal and committed-cache barrier", () => {
  const reference = readFileSync(
    new URL("../docs/reference/05-watcher.md", import.meta.url),
    "utf8",
  );
  expect(reference).toContain("waits for the repository signal that names its probe");
  expect(reference).toContain(
    "The cache must contain the probe and the session's `.lock` must be absent",
  );
});

it("documents the repository signal in overdue diagnostics", () => {
  const reference = readFileSync(new URL("../docs/reference/11-perf.md", import.meta.url), "utf8");
  expect(reference).toContain("the first repository signal naming the settle's own file");
});
