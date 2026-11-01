/** The two writers that used to work outside the session's lock
 * ([03-storage.md](../docs/reference/03-storage.md)). */
import { ok } from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, DomainError, reopen, reply, resolve } from "../src/core/domain/index.ts";
import type { Comment } from "../src/core/storage/index.ts";
import {
  readComments,
  readDiffCache,
  readReview,
  reviewPath,
  sessionDir,
  withLock,
  writeComments,
  writeDiffCache,
  writeReview,
} from "../src/core/storage/index.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { makeRoot, REPOS } from "./helpers/fixture-root.ts";
import { comment } from "./helpers/session.ts";

const noUi: UiAssets = { read: async () => null };

const lockProbe = vi.hoisted(() => ({
  path: "",
  contended: () => {},
  attempts: 0,
  readPath: "",
  readStarted: () => {},
  resumeRead: Promise.resolve(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    mkdir: async (...args: Parameters<typeof original.mkdir>) => {
      try {
        return await original.mkdir(...args);
      } catch (error) {
        if (
          args[0] === lockProbe.path &&
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          lockProbe.attempts += 1;
          lockProbe.contended();
        }
        throw error;
      }
    },
    readFile: async (...args: Parameters<typeof original.readFile>) => {
      if (args[0] === lockProbe.readPath) {
        lockProbe.readPath = "";
        lockProbe.readStarted();
        await lockProbe.resumeRead;
      }
      return original.readFile(...args);
    },
  };
});

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function observeLock(dir: string): Promise<void> {
  const contended = signal();
  lockProbe.path = join(dir, ".lock");
  lockProbe.attempts = 0;
  lockProbe.contended = contended.resolve;
  return contended.promise;
}

async function reachedLock(pending: Promise<unknown>, contended: Promise<void>): Promise<void> {
  expect(
    await Promise.race([contended.then(() => "contended"), pending.then(() => "finished")]),
  ).toBe("contended");
}

let root: string;
let config: Config;

async function cli(...argv: string[]): Promise<number> {
  return run([...argv, "--root", root], noUi, { out: () => {}, err: () => {} });
}

beforeAll(async () => {
  root = makeRoot();
  config = await loadConfig({ root });
}, 60_000);

afterEach(() => {
  lockProbe.path = "";
  lockProbe.readPath = "";
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a comment written while the scope narrows", () => {
  it.each([false, true])(
    "is refused after lock contention (delayed scope read: %s)",
    async (delayed) => {
      const SESSION = `narrowing-${delayed}`;
      expect(await cli("review", "new", SESSION, "--repo", REPOS[0], "--repo", REPOS[1])).toBe(0);
      const finding = {
        repo: REPOS[0],
        path: "file.txt",
        severity: "warning" as const,
        body: "a finding",
        author: "kim.p",
        role: "human" as const,
      };
      const dir = sessionDir(config.dataDir, SESSION);
      const readStarted = signal();
      const resumeRead = signal();
      let pending: Promise<unknown> = Promise.resolve(null);
      try {
        await withLock(dir, async (held) => {
          const contended = observeLock(dir);
          if (delayed) {
            lockProbe.readPath = reviewPath(config.dataDir, SESSION);
            lockProbe.readStarted = readStarted.resolve;
            lockProbe.resumeRead = resumeRead.promise;
          }
          pending = addComment(config.dataDir, SESSION, finding).catch((error: unknown) => error);
          if (delayed) {
            await readStarted.promise;
            expect(lockProbe.attempts).toBe(0);
            await held.assertHeld();
            resumeRead.resolve();
          }
          await reachedLock(pending, contended);
          await held.assertHeld();
          const review = await readReview(config.dataDir, SESSION);
          await writeReview(config.dataDir, SESSION, {
            ...review,
            scope: [{ repo: REPOS[1], paths: null }],
          });
        });
      } finally {
        resumeRead.resolve();
        await pending;
      }

      const outcome = await pending;
      expect(outcome).toBeInstanceOf(DomainError);
      expect(outcome).toMatchObject({ code: "out-of-scope" });
      // The message of the check inside the lock, not of the cheap one before it:
      // the codes are the same, so only the text says which refusal this was.
      expect(outcome).toMatchObject({
        message: expect.stringContaining("narrowed while this comment was being written"),
      });
      expect(await readComments(config.dataDir, SESSION)).toEqual([]);
    },
    60_000,
  );
});

/** The other half of the scope read inside the lock: a thread the scope took in while the writer
 * waited for the lock is found, not refused with `no-such-comment` (DA-67.1). */
describe("a thread answered while the scope widens", () => {
  const human = { author: "kim.p", role: "human" as const };
  const writers: Record<string, (session: string, id: string) => Promise<Comment>> = {
    reply: (session, id) => reply(config.dataDir, session, id, { ...human, body: "answered" }),
    resolve: (session, id) => resolve(config.dataDir, session, id, human),
    reopen: (session, id) => reopen(config.dataDir, session, id, human),
  };

  it.each(Object.entries(writers))(
    "is found by %s",
    async (writer, write) => {
      const session = `widening-${writer}`;
      expect(await cli("review", "new", session, "--repo", REPOS[0], "--no-use")).toBe(0);
      // Outside the scope, the way a hand edit or a narrowing leaves one.
      await writeComments(config.dataDir, session, [comment("c_widen1", { repo: REPOS[1] })]);
      let pending: Promise<unknown> = Promise.resolve(null);
      const dir = sessionDir(config.dataDir, session);
      try {
        await withLock(dir, async (held) => {
          const contended = observeLock(dir);
          pending = write(session, "c_widen1").catch((error: unknown) => error);
          await reachedLock(pending, contended);
          await held.assertHeld();
          const review = await readReview(config.dataDir, session);
          await writeReview(config.dataDir, session, { ...review, scope: null });
        });
      } finally {
        await pending;
      }

      expect(await pending).toMatchObject({ id: "c_widen1" });
    },
    60_000,
  );
});

describe("`diff` writing its cache while a watcher holds the lock", () => {
  const SESSION = "watched";

  it("loses no repository out of diff.json", async () => {
    expect(await cli("review", "new", SESSION)).toBe(0);
    expect(await cli("diff")).toBe(0);
    const full = await readDiffCache(config.dataDir, SESSION);
    expect(full?.repositories.map((one) => one.path).sort()).toEqual([...REPOS].sort());

    ok(full !== null);
    const cache = full;
    // The stale cache a watcher would read: one repository of the two.
    await writeDiffCache(config.dataDir, SESSION, {
      ...cache,
      repositories: cache.repositories.slice(0, 1),
    });

    let running: Promise<number> = Promise.resolve(0);
    const dir = sessionDir(config.dataDir, SESSION);
    try {
      await withLock(dir, async (held) => {
        const previous = await readDiffCache(config.dataDir, SESSION);
        ok(previous !== null);
        const contended = observeLock(dir);
        running = cli("diff");
        await reachedLock(running, contended);
        await held.assertHeld();
        const now = await readDiffCache(config.dataDir, SESSION);
        expect(now?.repositories.map((one) => one.path)).toEqual([REPOS[0]]);
        await writeDiffCache(config.dataDir, SESSION, previous);
      });
    } finally {
      await running;
    }

    expect(await running).toBe(0);
    const after = await readDiffCache(config.dataDir, SESSION);
    expect(after?.repositories.map((one) => one.path).sort()).toEqual([...REPOS].sort());
  }, 60_000);
});
