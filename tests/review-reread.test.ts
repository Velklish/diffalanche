/**
 * Two re-reads of one held document that end in the other order from the one they were asked
 * in. A plain race does not reach that order, so the domain's `list` is mocked for this file and
 * the steps are ordered with a gate, as `tests/storage-lock-race.test.ts` orders its writers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment } from "../src/core/domain/index.ts";
import { createReviewService } from "../src/server/review.ts";

const SESSION = "synth";

type Gate = { promise: Promise<void>; open: () => void };

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Run once by the next `list` after it has read the files, before it hands them back. */
const hooks: { afterList: (() => Promise<void>) | null } = { afterList: null };

vi.mock("../src/core/domain/index.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/core/domain/index.ts")>();
  return {
    ...original,
    list: async (...args: Parameters<typeof original.list>) => {
      const read = await original.list(...args);
      const after = hooks.afterList;
      if (after !== null) {
        hooks.afterList = null;
        await after();
      }
      return read;
    },
  };
});

let root: string;
let config: Config;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-reread-"));
  generate({ out: root, seed: 11, profile: PROFILES.small });
  config = await loadConfig({ root });
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("two re-reads of a held document", () => {
  it("keeps the later one when the earlier one lands last", async () => {
    const service = createReviewService(config);
    await service.document(SESSION);
    service.dataChanged();
    const reached = gate();
    const released = gate();
    hooks.afterList = async () => {
      reached.open();
      await released.promise;
    };
    // Asked first, and held with what the files said before the write below.
    const earlier = service.document(SESSION);
    await reached.promise;

    const written = await addComment(config.dataDir, SESSION, {
      severity: "nit",
      body: "written between the two re-reads",
      author: "kim.p",
      role: "human",
    });
    service.dataChanged();
    const later = await service.document(SESSION);
    expect(later.comments.map((one) => one.id)).toContain(written.id);

    released.open();
    await earlier;
    // The earlier read's files are older than what is held: it must not put them back.
    const after = await service.document(SESSION);
    expect(after.comments.map((one) => one.id)).toContain(written.id);
  });
});
