/** A temporary file next to the target, flushed, then renamed over it: which crash that survives
 * is [03-storage.md](../../../docs/reference/03-storage.md), "Atomic writes" ([ADR-003](../../../docs/adr/adr-003-on-disk-format.md)). */
import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { StorageError } from "./errors.ts";

type AtomicWriteOptions = {
  /** Flush the directory entry too. `false` for a file the tool can write again. */
  durable?: boolean;
};

export async function writeFileAtomic(
  path: string,
  content: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  // Same directory as the target: a rename across filesystems is a copy, and a
  // copy is exactly the torn write this exists to prevent. The suffix is random
  // rather than the pid: an operating system reuses pids, and a leftover from a
  // crashed process with the same pid would fail the exclusive create.
  const temp = `${path}.tmp-${randomUUID()}`;
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    // A failed write leaves nothing behind; the target still holds what it held.
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  if (options.durable !== false) await syncDir(dirname(path));
}

/** The flush a platform is allowed to refuse, and nothing else: `fsync` of a directory. */
const UNSUPPORTED = new Set(["EINVAL", "ENOTSUP"]);

/** Flushes the entry the rename created; the bytes it points at are already down. */
async function syncDir(path: string): Promise<void> {
  // A platform that will not open a directory at all skips the flush; the write
  // it belongs to is published either way.
  const handle = await open(path, "r").catch(() => null);
  if (handle === null) return;
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== undefined && UNSUPPORTED.has(code)) return;
    // A failed flush is a refusal of this file, not a fault of the tool: the
    // caller asked for durability and is told it did not happen.
    throw new StorageError(path, null, `durability flush failed: ${code ?? String(error)}`);
  } finally {
    await handle.close();
  }
}
