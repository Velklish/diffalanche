/**
 * The write lock of one review session ([ADR-003](../../../docs/adr/adr-003-on-disk-format.md)):
 * a `.lock` directory inside the session directory, created with `mkdir`, which
 * fails when it already exists and so is the atomic primitive here. The UI and
 * any number of CLI processes share this code, so no message is lost.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileAtomic } from "./atomic.ts";
import { StorageError } from "./errors.ts";
import { toJson } from "./schema.ts";

/** How long a writer waits for the lock before it gives up. */
const DEFAULT_TIMEOUT_MS = 10_000;
/** How long a holder claims the lock for; past that another writer takes it over. */
const DEFAULT_STALE_MS = 30_000;
const FIRST_RETRY_MS = 5;
const MAX_RETRY_MS = 100;

export type LockOptions = {
  timeoutMs?: number;
  staleMs?: number;
};

/**
 * The lock as the body of `withLock` sees it. A body that runs longer than
 * `staleMs` can have the lock taken from it, so a body that writes calls
 * `assertHeld` immediately before the write and gets a refusal instead of a
 * silent overwrite of somebody else's work.
 */
export type Lock = {
  assertHeld: () => Promise<void>;
};

/**
 * What the holder writes into the lock. `expiresAt` is the holder's own
 * deadline: a writer that finds the lock past it takes it over, so a process
 * killed mid-write blocks the next one for that long and no longer.
 */
type LockInfo = {
  token: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
};

/**
 * Runs `fn` while holding the session's lock, and releases it whatever `fn`
 * does. Waiting is bounded: past `timeoutMs` the call refuses rather than
 * hanging a CLI process for ever.
 */
export async function withLock<T>(
  sessionDir: string,
  fn: (lock: Lock) => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockDir = join(sessionDir, ".lock");
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  let wait = FIRST_RETRY_MS;
  while (!(await acquire(lockDir, token, staleMs))) {
    if (Date.now() >= deadline) {
      throw new StorageError(lockDir, null, `held by another writer for over ${timeoutMs} ms`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, MAX_RETRY_MS);
  }

  try {
    return await fn({ assertHeld: () => assertHeld(lockDir, token) });
  } finally {
    await release(lockDir, token);
  }
}

function infoPath(lockDir: string): string {
  return join(lockDir, "info.json");
}

async function readInfo(lockDir: string): Promise<Partial<LockInfo> | null> {
  try {
    return JSON.parse(await readFile(infoPath(lockDir), "utf8")) as Partial<LockInfo>;
  } catch {
    return null;
  }
}

async function acquire(lockDir: string, token: string, staleMs: number): Promise<boolean> {
  try {
    await mkdir(lockDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await takeOverIfStale(lockDir);
    return false;
  }
  const now = Date.now();
  const info: LockInfo = {
    token,
    pid: process.pid,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + staleMs).toISOString(),
  };
  await writeFileAtomic(infoPath(lockDir), toJson(info));
  return true;
}

/**
 * Takes over a lock past its deadline by **renaming** it aside and deleting the
 * renamed directory. Removing it in place is not enough: two writers that find
 * the same stale lock would both remove it, the first would then create its
 * own, and the second's delayed removal would take that fresh lock away — two
 * holders and the lost write ADR-003 exists to prevent. A rename is atomic, so
 * exactly one of the two moves the stale lock and the other finds it gone and
 * simply tries again.
 */
async function takeOverIfStale(lockDir: string): Promise<void> {
  const deadline = await lockDeadline(lockDir);
  if (deadline === null || Date.now() < deadline) return;

  const aside = `${lockDir}.stale-${randomUUID()}`;
  try {
    await rename(lockDir, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await rm(aside, { recursive: true, force: true });
}

/**
 * The deadline the holder recorded, or — while the holder is between `mkdir`
 * and its write, or after it died in that gap — the directory's own age plus
 * the default. `null` means the lock is gone and the caller should simply retry.
 */
async function lockDeadline(lockDir: string): Promise<number | null> {
  const info = await readInfo(lockDir);
  const expires = Date.parse(String(info?.expiresAt));
  if (Number.isFinite(expires)) return expires;
  try {
    return (await stat(lockDir)).mtimeMs + DEFAULT_STALE_MS;
  } catch {
    return null;
  }
}

/** Refuses when the lock is no longer ours: another writer took it over as stale. */
async function assertHeld(lockDir: string, token: string): Promise<void> {
  const info = await readInfo(lockDir);
  if (info?.token === token) return;
  throw new StorageError(
    lockDir,
    null,
    "the lock was taken over while this write was in progress; it ran longer than the lock lease",
  );
}

/**
 * Releases the lock only while it is still ours: a lock taken over as stale
 * belongs to the writer that took it, and removing it would hand a third
 * writer the same session at the same time.
 */
async function release(lockDir: string, token: string): Promise<void> {
  const info = await readInfo(lockDir);
  if (info?.token !== token) return;
  await rm(lockDir, { recursive: true, force: true });
}
