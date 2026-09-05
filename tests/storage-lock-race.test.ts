/**
 * Two writers on one stale lock. The windows these tests open are narrow, and a
 * plain race does not reach them: the writers pass through them together and
 * the result looks correct. So `node:fs/promises` is mocked for this file and
 * the steps are ordered with gates rather than with sleeps — the sequence is
 * then the same on a fast machine and on a loaded one. The assertions read the
 * disk through the synchronous API, which the mock does not touch.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** How long a body holds the lock, and how long the one delay left in time is. */
const BODY_MS = 200;
const RM_DELAY_MS = 40;

type Gate = { promise: Promise<void>; open: () => void };

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * What the mocked file system does at the two moments that matter: just before
 * a lock is moved aside, and just before a writer's claim reaches its
 * `info.json`. Each hook fires once — the first writer to arrive takes it.
 */
const hooks: {
  beforeTakeoverMove: (() => Promise<void>) | null;
  afterTakeoverMove: (() => void) | null;
  beforeClaimWrite: (() => Promise<void>) | null;
  slowFirstRm: boolean;
} = {
  beforeTakeoverMove: null,
  afterTakeoverMove: null,
  beforeClaimWrite: null,
  slowFirstRm: false,
};
let rmCalls = 0;

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rm: async (
      path: Parameters<typeof original.rm>[0],
      options?: Parameters<typeof original.rm>[1],
    ) => {
      rmCalls += 1;
      if (hooks.slowFirstRm && rmCalls === 1) await sleep(RM_DELAY_MS);
      return original.rm(path, options);
    },
    rename: async (from: string, to: string) => {
      if (hooks.beforeTakeoverMove !== null && to.includes(".stale-")) {
        const before = hooks.beforeTakeoverMove;
        hooks.beforeTakeoverMove = null;
        await before();
        const result = await original.rename(from, to);
        hooks.afterTakeoverMove?.();
        return result;
      }
      if (hooks.beforeClaimWrite !== null && to.endsWith(`${sep}info.json`)) {
        const before = hooks.beforeClaimWrite;
        hooks.beforeClaimWrite = null;
        await before();
      }
      return original.rename(from, to);
    },
  };
});

const { withLock } = await import("../src/core/storage/lock.ts");

let dir: string;
const order: string[] = [];

/** Opened by whichever writer gets the lock first, the moment its body starts. */
let onFirstBody: (() => void) | null = null;

const body = (label: string) => async (): Promise<string> => {
  order.push(`${label} in`);
  onFirstBody?.();
  onFirstBody = null;
  await sleep(BODY_MS);
  order.push(`${label} out`);
  return label;
};

/** One writer runs to the end before the other starts. */
function expectSerialised(): void {
  expect(order).toHaveLength(4);
  expect(order[1]).toBe(order[0]?.replace(" in", " out"));
  expect(order[3]).toBe(order[2]?.replace(" in", " out"));
  expect(order[2]).not.toBe(order[0]);
}

function bothWriters(): Promise<string[]> {
  return Promise.all([
    withLock(dir, body("a"), { timeoutMs: 5_000 }),
    withLock(dir, body("b"), { timeoutMs: 5_000 }),
  ]);
}

/** A lock left behind by a writer that is gone: its own deadline is in the past. */
function staleLock(): void {
  mkdirSync(join(dir, ".lock"), { recursive: true });
  writeFileSync(
    join(dir, ".lock", "info.json"),
    JSON.stringify({
      token: "dead",
      pid: 1,
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "diffalanche-lock-race-"));
  order.length = 0;
  rmCalls = 0;
  hooks.beforeTakeoverMove = null;
  hooks.afterTakeoverMove = null;
  hooks.beforeClaimWrite = null;
  hooks.slowFirstRm = false;
  onFirstBody = null;
  staleLock();
});

afterEach(() => {
  hooks.beforeTakeoverMove = null;
  hooks.afterTakeoverMove = null;
  hooks.beforeClaimWrite = null;
  hooks.slowFirstRm = false;
  rmSync(dir, { recursive: true, force: true });
});

describe("taking over a stale lock", () => {
  it("never lets both writers hold it, even when one takeover is slow", async () => {
    // Removing a stale lock in place lets the second writer create its own
    // inside the first writer's removal. The delay is on `rm` because that is
    // the call the broken version makes.
    hooks.slowFirstRm = true;

    expect((await bothWriters()).sort()).toEqual(["a", "b"]);
    // Interleaved entries would mean two holders, and the second writer's file
    // overwriting the first's is the lost write ADR-003 exists to prevent.
    expectSerialised();
  });

  it("puts back a lock that stopped being the stale one between the check and the move", async () => {
    // The first writer finds the lock stale and then stalls until the second
    // has taken over and is working, so what it finally moves is a live lock.
    const working = gate();
    hooks.beforeTakeoverMove = () => working.promise;
    onFirstBody = working.open;

    expect((await bothWriters()).sort()).toEqual(["a", "b"]);
    expectSerialised();
  });

  it("survives a lock moved out from under a writer still claiming it", async () => {
    // The second writer takes the stale lock over and creates its own, and the
    // first writer's move lands while that claim is still unfinished: the lock
    // directory holds nothing but the other's half-written temporary file.
    const claiming = gate();
    const moved = gate();
    hooks.beforeTakeoverMove = () => claiming.promise;
    hooks.afterTakeoverMove = () => moved.open();
    hooks.beforeClaimWrite = async () => {
      claiming.open();
      await moved.promise;
    };

    expect((await bothWriters()).sort()).toEqual(["a", "b"]);
    expectSerialised();
    expect(readdirSync(dirname(dir)).filter((name) => name.includes(".stale-"))).toEqual([]);
  });
});
