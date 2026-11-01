import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { TreeSource } from "../src/core/watcher/tree.ts";
import { perDirectory } from "../src/core/watcher/tree.ts";

type Handle = {
  dir: string;
  closed: boolean;
  closedOnce: Promise<void>;
  close: () => void;
  emit: (event: string, error: Error) => boolean;
  fire: (event: string, name: string) => boolean;
};
const handles = vi.hoisted(() => [] as Handle[]);

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const { EventEmitter } = await import("node:events");
  const watch = (
    dir: string,
    _options: { recursive: boolean },
    callback: (event: string, name: string) => void,
  ) => {
    let closed: () => void = () => undefined;
    const closedOnce = new Promise<void>((resolve) => {
      closed = resolve;
    });
    class InertWatcher extends EventEmitter {
      dir = dir;
      closed = false;
      closedOnce = closedOnce;
      close(): void {
        this.closed = true;
        closed();
      }
      fire(event: string, name: string): boolean {
        if (this.closed) return false;
        callback(event, name);
        return true;
      }
    }
    const watcher = new InertWatcher();
    handles.push(watcher);
    return watcher;
  };
  return { ...real, default: { ...real, watch }, watch };
});

let fixture = "";
let source: TreeSource | null = null;

afterEach(() => {
  source?.close();
  rmSync(fixture, { recursive: true, force: true });
  expect(handles.every((one) => one.closed)).toBe(true);
  expect(existsSync(fixture)).toBe(false);
  handles.length = 0;
});

for (const replacement of ["link", "directory"] as const) {
  it(`keeps the root alive after an errored child becomes another ${replacement}`, async () => {
    fixture = mkdtempSync(join(tmpdir(), "diffalanche-watch-path-error-"));
    const realRoot = join(fixture, "root");
    const dir = join(fixture, "named-root");
    const outside = join(fixture, "outside");
    const childPath = join(dir, "dist");
    mkdirSync(join(realRoot, "dist"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "outside content\n");
    symlinkSync(realRoot, dir);
    const heard: string[] = [];
    let later: () => void = () => undefined;
    let baseline: () => void = () => undefined;
    const delivered = new Promise<void>((resolve) => {
      later = resolve;
    });
    const rearmed = new Promise<void>((resolve) => {
      baseline = resolve;
    });
    let fallbacks = 0;
    source = perDirectory(
      {
        dir,
        ignore: () => false,
        onChange: (path) => {
          heard.push(path);
          if (path === "marker-later") later();
          if (path === "dist/baseline.ts") baseline();
        },
      },
      () => {
        fallbacks += 1;
      },
    );
    if (source === null) throw new Error("the inert root was not taken");
    await source.ready;
    const root = handles.find((one) => one.dir === dir);
    const child = handles.find((one) => one.dir === childPath);
    if (root === undefined || child === undefined) throw new Error("initial owners missing");
    expect(handles).toHaveLength(2);
    // Keep the old inode alive, so a replacement cannot reuse its identity on this filesystem.
    renameSync(childPath, join(fixture, "previous"));
    if (replacement === "link") symlinkSync(outside, childPath);
    else {
      mkdirSync(childPath);
      writeFileSync(join(childPath, "baseline.ts"), "baseline\n");
    }
    expect(child.closed).toBe(false);
    child.emit("error", new Error("inert child replacement error"));
    await child.closedOnce;
    expect(root.closed, "a replaced child must not fail the whole tree").toBe(false);
    expect(fallbacks).toBe(0);
    if (replacement === "directory") {
      await rearmed;
      expect(handles.filter((one) => one.dir === childPath && !one.closed)).toHaveLength(1);
    }
    writeFileSync(join(dir, "marker-later"), "later\n");
    expect(root.fire("change", "marker-later")).toBe(true);
    await delivered;
    expect(heard).toContain("marker-later");
    expect(heard.some((path) => path.includes("secret"))).toBe(false);
  }, 5_000);
}
