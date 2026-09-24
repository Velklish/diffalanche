/**
 * The write lock of one review session ([ADR-003](../../../docs/adr/adr-003-on-disk-format.md)):
 * a `.lock` directory inside the session directory, created with `mkdir`, which
 * fails when it already exists and so is the atomic primitive here. The UI and
 * any number of CLI processes share this code, so no message is lost.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileAtomic } from "./atomic.ts";
import { NoSuchSessionError, StorageError } from "./errors.ts";
import { toJson } from "./schema.ts";

/** How long a holder claims the lock for; past that another writer takes it over. */
const DEFAULT_STALE_MS = 30_000;
/** How long a writer waits: the lease, because a shorter wait never reaches the takeover. */
const DEFAULT_TIMEOUT_MS = DEFAULT_STALE_MS;
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
type Lock = {
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
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  // The floor is the invariant: a writer that gives up before the lease it
  // would itself claim never reaches the takeover of a dead holder's lock.
  const timeoutMs = Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, staleMs);
  const lockDir = join(sessionDir, ".lock");
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;

  let wait = FIRST_RETRY_MS;
  while (!(await acquire(lockDir, token, staleMs))) {
    if (Date.now() >= deadline) throw await refusal(lockDir, timeoutMs);
    await sleep(wait);
    wait = Math.min(wait * 2, MAX_RETRY_MS);
  }

  try {
    return await fn({ assertHeld: () => assertHeld(lockDir, token) });
  } finally {
    await release(lockDir, token);
  }
}

/** The refusal says what the waiter read out of the lock: an unexplained wait is unreadable without it. */
async function refusal(lockDir: string, timeoutMs: number): Promise<StorageError> {
  const info = await readInfo(lockDir);
  const pid = info?.pid;
  const acquiredAt = info?.acquiredAt;
  const expiresAt = info?.expiresAt;
  // A claim counts only whole: half of one names a holder out of `undefined`.
  const holder =
    pid === undefined || acquiredAt === undefined || expiresAt === undefined
      ? "held by a writer that has not claimed it"
      : `held by pid ${pid} since ${acquiredAt}, its lease running to ${expiresAt}`;
  return new StorageError(lockDir, null, `${holder}; gave up after ${timeoutMs} ms`);
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
    // The session directory is gone: deleted while this writer waited for it (DA-40).
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NoSuchSessionError(dirname(lockDir));
    }
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
  try {
    // Not durable: a lock outlives neither the write it guards nor the crash.
    await writeFileAtomic(infoPath(lockDir), toJson(info), { durable: false });
  } catch (error) {
    // The directory was moved out from under us between the `mkdir` and this
    // write: another writer was taking over a lock it had found stale a moment
    // earlier and had not looked at since. The claim simply did not happen, so
    // this is a failed acquisition and not a fault.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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
  const seen = await readInfo(lockDir);
  const deadline = await lockDeadline(lockDir, seen);
  if (deadline === null || Date.now() < deadline) return;

  const aside = `${lockDir}.stale-${randomUUID()}`;
  try {
    await rename(lockDir, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  // Reading the lock and moving it are two steps, so what was moved may not be
  // the lock that was found stale: another writer can take over and start
  // working in between. The token says which it is, and a live lock goes
  // straight back.
  //
  // A moved lock with no `info.json` at all is nobody's: its holder either died
  // between the `mkdir` and the write, or has not finished claiming it. Putting
  // that back would leave a lock no writer owns and no writer may take over
  // until it ages out; deleting it makes the unfinished claim fail, and that
  // writer simply tries again.
  const moved = await readInfo(aside);
  if (moved !== null && moved.token !== seen?.token) {
    try {
      await rename(aside, lockDir);
      return;
    } catch {
      // The slot is taken again; the writer whose lock this was finds out from
      // `assertHeld` before it writes anything.
    }
  }
  await rm(aside, { recursive: true, force: true });
}

/**
 * The deadline the holder recorded, or — while the holder is between `mkdir`
 * and its write, or after it died in that gap — the directory's own age plus
 * the default. `null` means the lock is gone and the caller should simply retry.
 */
async function lockDeadline(
  lockDir: string,
  info: Partial<LockInfo> | null,
): Promise<number | null> {
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

/** Releases the lock by moving it aside first, as the takeover does ([03-storage.md](../../../docs/reference/03-storage.md)). */
async function release(lockDir: string, token: string): Promise<void> {
  const aside = `${lockDir}.released-${randomUUID()}`;
  try {
    await rename(lockDir, aside);
  } catch (error) {
    // Already gone, which is the ordinary case after a takeover.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  // What was moved may be the lock of a writer that took this session over
  // meanwhile; that one goes straight back, as in `takeOverIfStale`.
  const moved = await readInfo(aside);
  if (moved !== null && moved.token !== token) {
    try {
      await rename(aside, lockDir);
      return;
    } catch {
      // The slot is taken again; that writer finds out from `assertHeld`.
    }
  }
  await rm(aside, { recursive: true, force: true });
}
