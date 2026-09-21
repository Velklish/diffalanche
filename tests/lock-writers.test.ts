/**
 * The two writers that used to work outside the session's lock
 * ([03-storage.md](../docs/reference/03-storage.md)).
 */
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, DomainError } from "../src/core/domain/index.ts";
import type { Comment, DiffCache } from "../src/core/storage/index.ts";
import {
  readComments,
  readDiffCache,
  readReview,
  sessionDir,
  withLock,
  writeDiffCache,
  writeReview,
} from "../src/core/storage/index.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { makeRoot, REPOS } from "./helpers/fixture-root.ts";

const noUi: UiAssets = { read: async () => null };

/** Long enough for the racing writer to reach the lock; short enough not to
 * redden the wall-clock budget of `tests/watcher.test.ts` beside it. */
const REACH_LOCK_MS = 150;
const AFTER_SCAN_MS = 400;

let root: string;
let config: Config;

async function cli(...argv: string[]): Promise<number> {
  return run([...argv, "--root", root], noUi, { out: () => {}, err: () => {} });
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

beforeAll(async () => {
  root = makeRoot();
  config = await loadConfig({ root });
}, 60_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a comment written while the scope narrows", () => {
  const SESSION = "narrowing";

  it("is refused rather than written where nothing can read it", async () => {
    expect(await cli("review", "new", SESSION, "--repo", REPOS[0], "--repo", REPOS[1])).toBe(0);

    let pending: Promise<Comment | unknown> = Promise.resolve(null);
    await withLock(sessionDir(config.dataDir, SESSION), async (held) => {
      pending = addComment(config.dataDir, SESSION, {
        repo: REPOS[0],
        path: "file.txt",
        severity: "warning",
        body: "a finding",
        author: "kim.p",
        role: "human",
      }).catch((error: unknown) => error);
      // If the writer has not reached the lock yet it refuses at its own check,
      // and the message asserted below is what says which of the two fired.
      await sleep(REACH_LOCK_MS);
      await held.assertHeld();
      const review = await readReview(config.dataDir, SESSION);
      await writeReview(config.dataDir, SESSION, {
        ...review,
        scope: [{ repo: REPOS[1], paths: null }],
      });
    });

    const outcome = await pending;
    expect(outcome).toBeInstanceOf(DomainError);
    expect((outcome as DomainError).code).toBe("out-of-scope");
    // The message of the check inside the lock, not of the cheap one before it:
    // the codes are the same, so only the text says which refusal this was.
    expect((outcome as DomainError).message).toContain(
      "narrowed while this comment was being written",
    );
    expect(await readComments(config.dataDir, SESSION)).toEqual([]);
  }, 60_000);
});

describe("`diff` writing its cache while a watcher holds the lock", () => {
  const SESSION = "watched";

  it("loses no repository out of diff.json", async () => {
    expect(await cli("review", "new", SESSION)).toBe(0);
    expect(await cli("diff")).toBe(0);
    const full = await readDiffCache(config.dataDir, SESSION);
    expect(full?.repositories.map((one) => one.path).sort()).toEqual([...REPOS].sort());

    const cache = full as DiffCache;
    // The stale cache a watcher would read: one repository of the two.
    await writeDiffCache(config.dataDir, SESSION, {
      ...cache,
      repositories: cache.repositories.slice(0, 1),
    });

    let running: Promise<number> = Promise.resolve(0);
    await withLock(sessionDir(config.dataDir, SESSION), async (held) => {
      const previous = await readDiffCache(config.dataDir, SESSION);
      running = cli("diff");
      // Long enough for the scan of the fixture to finish behind the lock.
      await sleep(AFTER_SCAN_MS);
      await held.assertHeld();
      // Still the cache this lock was taken over: a `diff` that wrote through
      // the lock would be here, and the assertion below would never see it.
      const now = await readDiffCache(config.dataDir, SESSION);
      expect(now?.repositories.map((one) => one.path)).toEqual([REPOS[0]]);
      await writeDiffCache(config.dataDir, SESSION, previous as DiffCache);
    });

    expect(await running).toBe(0);
    const after = await readDiffCache(config.dataDir, SESSION);
    expect(after?.repositories.map((one) => one.path).sort()).toEqual([...REPOS].sort());
  }, 60_000);
});
