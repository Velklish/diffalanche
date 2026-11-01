import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TreeSource } from "../src/core/watcher/tree.ts";
import { perDirectory } from "../src/core/watcher/tree.ts";

type Gate = { promise: Promise<void>; resolve: () => void };
type Handle = {
  dir: string;
  closed: boolean;
  close: () => void;
  emit: (event: string, error: Error) => boolean;
  fire: (event: string, name: string | null) => boolean;
};
type State = {
  handles: Handle[];
  path: string;
  holdNext: boolean;
  observed: string;
  captured: Gate;
  release: Gate;
  baseline: Gate;
  reconciled: Gate;
  later: Gate;
  completion: Promise<unknown> | null;
  fallbacks: number;
};

const seam = vi.hoisted(() => {
  const gate = (): Gate => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  const fresh = (): State => ({
    handles: [],
    path: "",
    holdNext: false,
    observed: "pending",
    captured: gate(),
    release: gate(),
    baseline: gate(),
    reconciled: gate(),
    later: gate(),
    completion: null,
    fallbacks: 0,
  });
  return { current: fresh(), fresh };
});

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const { EventEmitter } = await import("node:events");
  const watch = (
    dir: string,
    _options: { recursive: boolean },
    callback: (event: string, name: string | null) => void,
  ) => {
    class InertWatcher extends EventEmitter {
      dir = dir;
      closed = false;
      close(): void {
        this.closed = true;
      }
      fire(event: string, name: string | null): boolean {
        if (this.closed) return false;
        callback(event, name);
        return true;
      }
    }
    const watcher = new InertWatcher();
    seam.current.handles.push(watcher);
    return watcher;
  };
  return { ...real, default: { ...real, watch }, watch };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const held = <T>(result: Promise<T>): Promise<T> => {
    const state = seam.current;
    state.holdNext = false;
    const completion = result.then(
      async (info) => {
        state.observed = "success";
        state.captured.resolve();
        await state.release.promise;
        return info;
      },
      async (error: unknown) => {
        state.observed =
          error instanceof Error && "code" in error ? String(error.code) : "missing-code";
        state.captured.resolve();
        await state.release.promise;
        throw error;
      },
    );
    state.completion = completion;
    return completion;
  };
  const stat = (...args: Parameters<typeof real.stat>) => {
    const result = real.stat(...args);
    return seam.current.holdNext && args.length === 1 && args[0] === seam.current.path
      ? held(result)
      : result;
  };
  const lstat = (...args: Parameters<typeof real.lstat>) => {
    const result = real.lstat(...args);
    return seam.current.holdNext && args[0] === seam.current.path ? held(result) : result;
  };
  return { ...real, default: { ...real, stat, lstat }, stat, lstat };
});

let dir = "";
let source: TreeSource | null = null;

beforeEach(async () => {
  seam.current = seam.fresh();
  const state = seam.current;
  dir = mkdtempSync(join(tmpdir(), "diffalanche-watch-error-"));
  mkdirSync(join(dir, "dist"));
  source = perDirectory(
    {
      dir,
      ignore: () => false,
      onChange: (path) => {
        if (path === "dist/baseline.ts") state.baseline.resolve();
        if (path === "dist") state.reconciled.resolve();
        if (path === "dist/later.ts") state.later.resolve();
      },
    },
    () => {
      state.fallbacks += 1;
    },
  );
  if (source === null) throw new Error("the inert root was not taken");
  await source.ready;
});

afterEach(async () => {
  source?.close();
  seam.current.release.resolve();
  await seam.current.completion?.catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
  expect(seam.current.handles.every((one) => one.closed)).toBe(true);
  expect(existsSync(dir)).toBe(false);
});

function owner(path: string): Handle {
  const handles = seam.current.handles.filter((one) => one.dir === path && !one.closed);
  expect(handles).toHaveLength(1);
  const handle = handles[0];
  if (handle === undefined) throw new Error(`no open owner for ${path}`);
  return handle;
}

async function capture(result: "success" | "ENOENT", previous: Handle): Promise<void> {
  const state = seam.current;
  if (result === "ENOENT") rmSync(join(dir, "dist"), { recursive: true });
  state.path = join(dir, "dist");
  state.holdNext = true;
  previous.emit("error", new Error("inert native error"));
  await state.captured.promise;
  expect(state.observed).toBe(result);
}

async function release(): Promise<void> {
  const completion = seam.current.completion;
  if (completion === null) throw new Error("no held stat completion");
  // The final path read resumes identity before this observer, then the owner's handler runs.
  const consumed = completion.catch(() => undefined);
  seam.current.release.resolve();
  await consumed;
}

const results: ("success" | "ENOENT")[] = ["success", "ENOENT"];

for (const result of results) {
  it(`ignores stale ${result} after replacing the directory owner`, async () => {
    const child = join(dir, "dist");
    const root = owner(dir);
    const previous = owner(child);
    await capture(result, previous);
    rmSync(child, { recursive: true, force: true });
    mkdirSync(child);
    writeFileSync(join(child, "baseline.ts"), "baseline\n");
    root.fire("rename", "dist");
    await seam.current.baseline.promise;
    await seam.current.reconciled.promise;
    const current = owner(child);
    expect(current).not.toBe(previous);
    await release();
    expect(current.closed).toBe(false);
    expect(root.closed).toBe(false);
    expect(seam.current.fallbacks).toBe(0);
    writeFileSync(join(child, "later.ts"), "later\n");
    expect(current.fire("change", "later.ts")).toBe(true);
    await seam.current.later.promise;
  }, 5_000);

  it(`handles the active owner's ${result}`, async () => {
    const root = owner(dir);
    const current = owner(join(dir, "dist"));
    await capture(result, current);
    await release();
    expect(current.closed).toBe(true);
    expect(root.closed).toBe(result === "success");
    expect(seam.current.fallbacks).toBe(result === "success" ? 1 : 0);
  }, 5_000);

  it(`ignores late ${result} after close`, async () => {
    const root = owner(dir);
    const current = owner(join(dir, "dist"));
    await capture(result, current);
    source?.close();
    await release();
    expect(current.closed).toBe(true);
    expect(root.closed).toBe(true);
    expect(seam.current.fallbacks).toBe(0);
  }, 5_000);
}
