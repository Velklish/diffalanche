/**
 * The crash between the temporary write and the rename. `node:fs/promises` is
 * mocked for this file alone, so the assertions read the disk through the
 * synchronous API, which the mock does not touch.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failRename = { value: false };
/** The errno the directory flush fails with, or `null` while it works. */
const dirSyncFails: { code: string | null } = { code: null };
/** What the write opened for reading, which is how the directory flush is seen from outside. */
const opened: string[] = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (path: string, flags?: string | number) => {
      if (flags !== "r") return original.open(path, flags);
      opened.push(path);
      const handle = await original.open(path, flags);
      if (dirSyncFails.code === null) return handle;
      const code = dirSyncFails.code;
      return {
        sync: async () => {
          throw Object.assign(new Error(`${code}: fsync failed`), { code });
        },
        close: () => handle.close(),
      };
    },
    rename: async (from: string, to: string) => {
      if (failRename.value) throw new Error("crash before the rename");
      return original.rename(from, to);
    },
  };
});

const { writeFileAtomic } = await import("../src/core/storage/atomic.ts");
const { StorageError } = await import("../src/core/storage/errors.ts");

let dir: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "diffalanche-atomic-"));
  target = join(dir, "comments.json");
  failRename.value = false;
  dirSyncFails.code = null;
  opened.length = 0;
});

afterEach(() => {
  failRename.value = false;
  dirSyncFails.code = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("replaces the file whole", async () => {
    await writeFileAtomic(target, "first\n");
    await writeFileAtomic(target, "second\n");
    expect(readFileSync(target, "utf8")).toBe("second\n");
    expect(readdirSync(dir)).toEqual(["comments.json"]);
  });

  it("syncs the directory the rename published the file in", async () => {
    await writeFileAtomic(target, "first\n");
    expect(opened).toEqual([dir]);
  });

  it("writes a file the tool can write again without the directory sync", async () => {
    await writeFileAtomic(target, "first\n", { durable: false });
    expect(opened).toEqual([]);
  });

  it("fails the write when the directory flush itself fails", async () => {
    dirSyncFails.code = "EIO";
    await expect(writeFileAtomic(target, "first\n")).rejects.toThrow(/EIO/);
  });

  it("refuses a failed flush as a StorageError, so the CLI answers 1 and not a stack", async () => {
    dirSyncFails.code = "EIO";
    const error = await writeFileAtomic(target, "first\n").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as Error).message).toBe(`${dir}: durability flush failed: EIO`);
  });

  it("finishes the write on a platform whose directories cannot be flushed", async () => {
    dirSyncFails.code = "EINVAL";
    await writeFileAtomic(target, "first\n");
    expect(readFileSync(target, "utf8")).toBe("first\n");
  });

  it("leaves the previous file intact when the rename never happens", async () => {
    await writeFileAtomic(target, "first\n");
    failRename.value = true;

    await expect(writeFileAtomic(target, "second\n")).rejects.toThrow("crash before the rename");
    expect(readFileSync(target, "utf8")).toBe("first\n");
    // Nothing was published, so nothing is flushed: the only open is the first
    // write's, before the failing one.
    expect(opened).toEqual([dir]);
    // The temporary file goes with the failed write: a directory of leftovers
    // is what a reader has to tell the real file from.
    expect(readdirSync(dir)).toEqual(["comments.json"]);
  });
});
