/** The crash between the temporary write and the rename. `node:fs/promises` is mocked for this
 * file alone, so the assertions read the disk through the synchronous API it leaves alone. */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const failRename = { value: false };
/** The errno the directory flush fails with, or `null` while it works. */
const dirSyncFails: { code: string | null } = { code: null };
const dirOpenFails: { code: string | null } = { code: null };
/** What the write opened for reading, which is how the directory flush is seen from outside. */
const opened: string[] = [];

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (path: string, flags?: string | number) => {
      if (flags !== "r") return original.open(path, flags);
      opened.push(path);
      if (dirOpenFails.code !== null) {
        throw Object.assign(new Error(`${dirOpenFails.code}: open failed`), {
          code: dirOpenFails.code,
        });
      }
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
  dirOpenFails.code = null;
  opened.length = 0;
});

afterEach(() => {
  failRename.value = false;
  dirSyncFails.code = null;
  dirOpenFails.code = null;
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("documents the directory-open errors that may skip durability", () => {
    const reference = readFileSync(
      new URL("../docs/reference/03-storage.md", import.meta.url),
      "utf8",
    );
    expect(reference).toContain(
      "only `EINVAL` and `ENOTSUP` from opening or syncing the directory\nskip the flush.",
    );
  });

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

  it.each(["EMFILE", "EIO", "EACCES", "EPERM"])(
    "reports directory-open %s after publishing the replacement",
    async (code) => {
      await writeFileAtomic(target, "first\n");
      dirOpenFails.code = code;
      const error = await writeFileAtomic(target, "second\n").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({ message: `${dir}: durability flush failed: ${code}` });
      expect(readFileSync(target, "utf8")).toBe("second\n");
      expect(readdirSync(dir)).toEqual(["comments.json"]);
    },
  );

  it.each(["EINVAL", "ENOTSUP"])(
    "keeps the published write when directory open is unsupported with %s",
    async (code) => {
      dirOpenFails.code = code;
      await writeFileAtomic(target, "first\n");
      expect(opened).toEqual([dir]);
      expect(readFileSync(target, "utf8")).toBe("first\n");
    },
  );

  it("does not open the directory for a non-durable write even when open would fail", async () => {
    dirOpenFails.code = "EIO";
    await writeFileAtomic(target, "first\n", { durable: false });
    expect(opened).toEqual([]);
    expect(readFileSync(target, "utf8")).toBe("first\n");
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

  it("fails on EPERM here, and on Windows does not flush the directory at all", async () => {
    dirSyncFails.code = "EPERM";
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (process.platform !== "win32") {
      await expect(writeFileAtomic(target, "first\n")).rejects.toThrow(/EPERM/);
    }
    opened.length = 0;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      dirOpenFails.code = "EIO";
      await writeFileAtomic(target, "second\n");
      expect(readFileSync(target, "utf8")).toBe("second\n");
      expect(opened).toEqual([]);
    } finally {
      if (platform !== undefined) Object.defineProperty(process, "platform", platform);
    }
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
