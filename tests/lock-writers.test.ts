/**
 * The two writers that used to work outside the session's lock
 * ([03-storage.md](../docs/reference/03-storage.md)).
 */
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, DomainError, reopen, reply, resolve } from "../src/core/domain/index.ts";
import type { Comment, DiffCache } from "../src/core/storage/index.ts";
import {
  readComments,
  readDiffCache,
  readReview,
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

/** Long enough for the racing writer to reach the lock; short enough not to
 * redden the wall-clock budget of `tests/watcher.test.ts` beside it. */
const REACH_LOCK_MS = 150;
/** The floor of the wait; the machine raises it when its own scan is slower. */
const AFTER_SCAN_MS = 400;
/** How much longer than the scan it timed the wait has to be to guard anything. */
const SCAN_MARGIN = 2;

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

/** The other half of the scope read inside the lock: a thread the scope took in while the writer
 * waited for the lock is found, not refused with `no-such-comment` (DA-67.1). */
describe("a thread answered while the scope widens", () => {
  const human = { author: "kim.p", role: "human" as const };
  const writers: Record<string, (session: string, id: string) => Promise<Comment>> = {
    reply: (session, id) => reply(config.dataDir, session, id, { ...human, body: "answered" }),
    resolve: (session, id) => resolve(config.dataDir, session, id, human),
    reopen: (session, id) => reopen(config.dataDir, session, id, human),
  };

  it.each(Object.keys(writers))(
    "is found by %s",
    async (writer) => {
      const session = `widening-${writer}`;
      expect(await cli("review", "new", session, "--repo", REPOS[0], "--no-use")).toBe(0);
      // Outside the scope, the way a hand edit or a narrowing leaves one.
      await writeComments(config.dataDir, session, [comment("c_widen1", { repo: REPOS[1] })]);

      let pending: Promise<Comment | unknown> = Promise.resolve(null);
      await withLock(sessionDir(config.dataDir, session), async (held) => {
        pending =
          writers[writer]?.(session, "c_widen1").catch((error: unknown) => error) ?? pending;
        await sleep(REACH_LOCK_MS);
        await held.assertHeld();
        const review = await readReview(config.dataDir, session);
        await writeReview(config.dataDir, session, { ...review, scope: null });
      });

      expect(await pending).toMatchObject({ id: "c_widen1" });
    },
    60_000,
  );
});

describe("`diff` writing its cache while a watcher holds the lock", () => {
  const SESSION = "watched";

  it("loses no repository out of diff.json", async () => {
    expect(await cli("review", "new", SESSION)).toBe(0);
    // The scan the locked writer below has to outrun, measured rather than
    // assumed: how long one takes is the machine's answer, not ours.
    const scanAt = performance.now();
    expect(await cli("diff")).toBe(0);
    const waitMs = Math.max(AFTER_SCAN_MS, Math.ceil((performance.now() - scanAt) * SCAN_MARGIN));
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
      // Twice the scan measured above, so a writer going past the lock has
      // written by now and the assertion below sees it.
      await sleep(waitMs);
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
