/**
 * Whole-file writes that a crash cannot tear ([ADR-003](../../../docs/adr/adr-003-on-disk-format.md)):
 * a temporary file next to the target, flushed to disk, then renamed over it.
 * Rename within one directory is atomic on every filesystem the tool runs on,
 * so a reader sees either the previous file or the new one and never a
 * half-written mixture.
 */
import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";

export async function writeFileAtomic(path: string, content: string): Promise<void> {
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
}
