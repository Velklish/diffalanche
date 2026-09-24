/** `updateIndex` when the `stat` of a comments.json is refused and its read is not — a change of
 * permissions between the two, which only a stubbed `stat` holds still (09-ml.md). */
import { mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addComment } from "../src/core/domain/index.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "../src/core/ml/embed/model.ts";
import { updateIndex } from "../src/core/ml/index/index.ts";
import { commentsPath } from "../src/core/storage/index.ts";
import { comment, makeSession } from "./helpers/session.ts";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, stat: vi.fn(real.stat) };
});

const realStat = (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"))
  .stat;

const embedder = {
  model: { ...EMBEDDING_MODEL, dimensions: 2 },
  identity: embeddingIdentity(),
  embed: async (texts: string[]) => texts.map(() => new Float32Array([1, 0])),
};

/** `stat` refuses `path` with `EACCES`, and answers every other path as it would. */
function refuseStatOf(path: string): void {
  vi.mocked(fs.stat).mockImplementation((async (target: Parameters<typeof realStat>[0]) => {
    if (String(target) === path) {
      throw Object.assign(new Error(`EACCES: permission denied, stat '${path}'`), {
        code: "EACCES",
        path,
      });
    }
    return realStat(target);
  }) as typeof fs.stat);
}

describe("a comments.json whose stat is refused and whose read is not", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "diffalanche-index-stat-"));
    await makeSession(dataDir, "alpha", [comment("c_a1", { body: "one" })]);
    await makeSession(dataDir, "beta", [comment("c_b1", { body: "two" })]);
  });

  afterEach(() => {
    vi.mocked(fs.stat).mockImplementation(realStat as typeof fs.stat);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("is indexed with no fingerprint, so it is read again rather than matched as absent", async () => {
    await updateIndex(dataDir, embedder);
    await addComment(dataDir, "alpha", {
      severity: "nit",
      body: "three",
      author: "a",
      role: "agent",
    });
    refuseStatOf(commentsPath(dataDir, "alpha"));
    const refused = await updateIndex(dataDir, embedder);
    expect(refused.update.warnings).toEqual([]);
    expect(refused.index.entries.map((entry) => entry.body)).toEqual(["one", "three", "two"]);
    expect(Object.keys(refused.index.sessions)).toEqual(["beta"]);

    // Gone once `stat` answers again: a fingerprint of `null` would have matched it and kept both.
    vi.mocked(fs.stat).mockImplementation(realStat as typeof fs.stat);
    rmSync(commentsPath(dataDir, "alpha"));
    const gone = await updateIndex(dataDir, embedder);
    expect(gone.index.entries.map((entry) => entry.body)).toEqual(["two"]);
  });
});
