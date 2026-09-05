/**
 * Two writers that find the same stale lock. The interleaving that breaks a
 * takeover done by removing the lock in place is narrow, and a plain race does
 * not reach it: both writers remove the lock before either recreates it, and
 * the result looks correct. So `rm` is delayed for the first caller only, which
 * puts the second writer's fresh lock inside the first writer's removal —
 * exactly the window ADR-003 forbids. `node:fs/promises` is mocked for this
 * file alone; the assertions read the disk through the synchronous API.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** How long the first `rm` of the run is held back, and how long a body runs. */
const RM_DELAY_MS = 40;
const BODY_MS = 200;

const slowFirstRm = { armed: false, calls: 0 };

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    rm: async (
      path: Parameters<typeof original.rm>[0],
      options?: Parameters<typeof original.rm>[1],
    ) => {
      slowFirstRm.calls += 1;
      if (slowFirstRm.armed && slowFirstRm.calls === 1) await sleep(RM_DELAY_MS);
      return original.rm(path, options);
    },
  };
});

const { withLock } = await import("../src/core/storage/lock.ts");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "diffalanche-lock-race-"));
  slowFirstRm.armed = false;
  slowFirstRm.calls = 0;
});

afterEach(() => {
  slowFirstRm.armed = false;
  rmSync(dir, { recursive: true, force: true });
});

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

describe("taking over a stale lock", () => {
  it("never lets both writers hold it, even when one takeover is slow", async () => {
    staleLock();
    const order: string[] = [];
    const body = (label: string) => async (): Promise<string> => {
      order.push(`${label} in`);
      await sleep(BODY_MS);
      order.push(`${label} out`);
      return label;
    };

    slowFirstRm.armed = true;
    const done = await Promise.all([
      withLock(dir, body("a"), { timeoutMs: 5_000 }),
      withLock(dir, body("b"), { timeoutMs: 5_000 }),
    ]);

    expect(done.sort()).toEqual(["a", "b"]);
    // One writer runs to the end before the other starts. Interleaved entries
    // would mean two holders, and the second writer's file overwriting the
    // first's is the lost write ADR-003 exists to prevent.
    expect(order[1]).toBe(order[0]?.replace(" in", " out"));
    expect(order[3]).toBe(order[2]?.replace(" in", " out"));
    expect(order[2]).not.toBe(order[0]);
  });
});
