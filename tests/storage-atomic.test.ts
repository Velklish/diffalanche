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

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rename: async (from: string, to: string) => {
      if (failRename.value) throw new Error("crash before the rename");
      return original.rename(from, to);
    },
  };
});

const { writeFileAtomic } = await import("../src/core/storage/atomic.ts");

let dir: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "diffalanche-atomic-"));
  target = join(dir, "comments.json");
  failRename.value = false;
});

afterEach(() => {
  failRename.value = false;
  rmSync(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("replaces the file whole", async () => {
    await writeFileAtomic(target, "first\n");
    await writeFileAtomic(target, "second\n");
    expect(readFileSync(target, "utf8")).toBe("second\n");
    expect(readdirSync(dir)).toEqual(["comments.json"]);
  });

  it("leaves the previous file intact when the rename never happens", async () => {
    await writeFileAtomic(target, "first\n");
    failRename.value = true;

    await expect(writeFileAtomic(target, "second\n")).rejects.toThrow("crash before the rename");
    expect(readFileSync(target, "utf8")).toBe("first\n");
    // The temporary file goes with the failed write: a directory of leftovers
    // is what a reader has to tell the real file from.
    expect(readdirSync(dir)).toEqual(["comments.json"]);
  });
});
