import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { TreeSource } from "../src/core/watcher/tree.ts";
import { perDirectory } from "../src/core/watcher/tree.ts";

type Handle = {
  dir: string;
  closed: boolean;
  closedOnce: Promise<void>;
  close: () => void;
  emit: (event: string, error: Error) => boolean;
  fire: (event: string, name: string | null) => boolean;
};
const handles = vi.hoisted(() => [] as Handle[]);

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const { EventEmitter } = await import("node:events");
  const watch = (
    dir: string,
    _options: { recursive: boolean },
    callback: (event: string, name: string | null) => void,
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
      fire(event: string, name: string | null): boolean {
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

for (const [name, earlierListing] of [
  [null, true],
  ["gone", true],
  ["marker-before", true],
  [null, false],
] as const) {
  it(`reports a removed directory with root name ${name}, earlier listing ${earlierListing}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-removed-entry-"));
    mkdirSync(join(dir, "gone", "deep"), { recursive: true });
    mkdirSync(join(dir, "kept"));
    let source: TreeSource | null = null;
    const heard: string[] = [];
    let failures = 0;
    let before: () => void = () => undefined;
    let after: () => void = () => undefined;
    let kept: () => void = () => undefined;
    const armed = new Promise<void>((resolve) => {
      before = resolve;
    });
    const settled = new Promise<void>((resolve) => {
      after = resolve;
    });
    const alive = new Promise<void>((resolve) => {
      kept = resolve;
    });
    let afterReports = 0;
    let from = 0;
    try {
      source = perDirectory(
        {
          dir,
          ignore: () => false,
          onChange: (path) => {
            heard.push(path);
            if (path === "marker-before") before();
            if (path === "marker-after" && ++afterReports === 2) after();
            if (path === "kept/after.ts") kept();
          },
        },
        () => {
          failures += 1;
        },
      );
      if (source === null) throw new Error("inert root missing");
      await source.ready;
      const owner = (relative: string): Handle => {
        const current = handles.filter((one) => one.dir === join(dir, relative) && !one.closed);
        expect(current).toHaveLength(1);
        if (current[0] === undefined) throw new Error("inert owner missing");
        return current[0];
      };
      const root = owner("");
      const gone = owner("gone");
      const deep = owner("gone/deep");
      const sibling = owner("kept");
      const fire = (watcher: Handle, event: string, payload: string | null): void => {
        expect(watcher.fire(event, payload)).toBe(true);
      };
      if (earlierListing) {
        mkdirSync(join(dir, "fresh", "deep"), { recursive: true });
        writeFileSync(join(dir, "fresh", "deep", "seed.ts"), "seed\n");
        writeFileSync(join(dir, "marker-before"), "before\n");
        fire(root, "change", "marker-before");
        await armed;
        expect(heard).toContain("fresh/deep/seed.ts");
        expect(heard).not.toContain("fresh/deep");
      }
      from = heard.length;
      rmSync(join(dir, "gone"), { recursive: true });
      fire(gone, "rename", null);
      await gone.closedOnce;
      expect(deep.closed).toBe(true);
      expect(root.closed).toBe(false);
      expect(sibling.closed).toBe(false);
      expect(failures).toBe(0);
      fire(root, "rename", name);
      writeFileSync(join(dir, "marker-after"), "after\n");
      fire(root, "change", "marker-after");
      await settled;
      writeFileSync(join(dir, "kept", "after.ts"), "kept\n");
      fire(sibling, "change", "after.ts");
      await alive;
      expect(root.closed).toBe(false);
      expect(sibling.closed).toBe(false);
      expect(source.polling).toBe(false);
      expect(failures).toBe(0);
      expect(heard.slice(from)).toContain("kept/after.ts");
      expect(
        heard.slice(from),
        "parent reconciliation must report the removed directory name",
      ).toContain("gone");
    } finally {
      source?.close();
      rmSync(dir, { recursive: true, force: true });
      expect(existsSync(dir)).toBe(false);
      expect(handles.every((one) => one.closed)).toBe(true);
      handles.length = 0;
    }
  }, 5_000);
}
