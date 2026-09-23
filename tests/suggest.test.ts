/** `src/core/ml/suggest`, `suggest` and `GET /api/suggest` without the model: the vote, the
 * route's shape and its refusals. The model's half is tests/embedding-model.test.ts. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { ModelError } from "../src/core/ml/embed/errors.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "../src/core/ml/embed/model.ts";
import { openThreadedEmbedder } from "../src/core/ml/embed/open.ts";
import { startThreadedEmbedder } from "../src/core/ml/embed/threaded.ts";
import type { Neighbour } from "../src/core/ml/index/index.ts";
import { proposeSeverity } from "../src/core/ml/suggest/index.ts";
import type { Severity } from "../src/core/storage/index.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";
import type { SuggestService } from "../src/server/suggest.ts";
import { createSuggestService } from "../src/server/suggest.ts";
import { comment, makeSession } from "./helpers/session.ts";

const noUi: UiAssets = { read: async () => null };

function neighbour(severity: Severity, similarity: number, id = `c_${similarity}`): Neighbour {
  return {
    session: "s",
    id,
    severity,
    repo: null,
    path: null,
    line: null,
    body: "",
    similarity,
  };
}

describe("the severity the neighbours vote for", () => {
  it("proposes nothing without neighbours or when the nearest is under the floor", () => {
    expect(proposeSeverity([])).toBeNull();
    expect(proposeSeverity([neighbour("critical", 0.859)])).toBeNull();
    expect(proposeSeverity([neighbour("critical", 0.859)], 0.01, 0.8)).toMatchObject({
      severity: "critical",
    });
  });

  it("weighs a neighbour by how far it is from the nearest, not by its count", () => {
    // Two warnings 0.05 below the nearest nit weigh e^-5 each at 0.01: the nit wins.
    const near = [
      neighbour("nit", 0.95),
      neighbour("warning", 0.9),
      neighbour("warning", 0.9, "b"),
    ];
    expect(proposeSeverity(near)).toEqual({ severity: "nit", confidence: 0.99 });
    // With equal weights the count would decide.
    expect(proposeSeverity(near, 1_000)?.severity).toBe("warning");
  });

  it("says how much of the weight agrees", () => {
    expect(proposeSeverity([neighbour("critical", 0.93), neighbour("critical", 0.92)])).toEqual({
      severity: "critical",
      confidence: 1,
    });
    const split = proposeSeverity([neighbour("warning", 0.9), neighbour("question", 0.9, "b")]);
    // A tie goes to the nearer of the two, and half the weight is all it has.
    expect(split).toEqual({ severity: "warning", confidence: 0.5 });
  });
});

describe("GET /api/suggest", () => {
  let dataDir: string;
  let app: Hono;
  let service: SuggestService;

  /** A vector of the text's characters: equal texts, equal vectors. */
  function vectorOf(text: string): Float32Array {
    const vector = new Float32Array(8);
    for (let i = 0; i < text.length; i += 1) {
      vector[i % 8] = (vector[i % 8] as number) + text.charCodeAt(i) * (i + 1);
    }
    const norm = Math.hypot(...vector);
    return vector.map((value) => value / norm);
  }

  async function appWith(suggest: SuggestService): Promise<Hono> {
    const config = await loadConfig({ root: dataDir, dataDir });
    return createApp({
      activity: createActivityLog(),
      config,
      events: createEventStream(),
      review: createReviewService(config),
      ui: noUi,
      suggest,
    });
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "diffalanche-suggest-"));
    await makeSession(dataDir, "alpha", [
      comment("c_a1", { body: "the null check is unreachable", severity: "nit" }),
      comment("c_a2", { body: "this allocates on every request", severity: "warning" }),
    ]);
    service = createSuggestService(dataDir, async () => ({
      model: { ...EMBEDDING_MODEL, dimensions: 8 },
      identity: embeddingIdentity(),
      embed: async (texts) => texts.map(vectorOf),
    }));
    app = await appWith(service);
  });

  afterEach(async () => {
    await service.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("answers with the neighbours, their sources, and the severity they vote for", async () => {
    const response = await app.request(
      `/api/suggest?body=${encodeURIComponent("this allocates on every request")}`,
    );
    expect(response.status).toBe(200);
    const answer = (await response.json()) as {
      severity: { severity: string; confidence: number } | null;
      suggestions: Neighbour[];
    };
    expect(answer.suggestions[0]).toMatchObject({
      session: "alpha",
      id: "c_a2",
      severity: "warning",
      repo: "repos/core/cargos-api",
      path: "src/a.ts",
      line: 42,
      body: "this allocates on every request",
      similarity: expect.closeTo(1, 5),
    });
    expect(answer.suggestions).toHaveLength(2);
    expect(answer.severity?.severity).toBe("warning");
  });

  it("refuses a request without a body", async () => {
    for (const query of ["", "?body=", "?body=%20%20"]) {
      const response = await app.request(`/api/suggest${query}`);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toEqual({
        error: "invalid-request",
        message: "body is required",
      });
    }
  });

  it("answers 503 naming the model when it is not there, and looks again next time", async () => {
    const empty = mkdtempSync(join(tmpdir(), "diffalanche-no-model-"));
    let opened = 0;
    const absent = createSuggestService(dataDir, () => {
      opened += 1;
      return openThreadedEmbedder(empty);
    });
    try {
      const without = await appWith(absent);
      for (let i = 0; i < 2; i += 1) {
        const response = await without.request("/api/suggest?body=anything");
        expect(response.status).toBe(503);
        const body = (await response.json()) as { error: string; message: string };
        expect(body.error).toBe("model");
        expect(body.message).toContain(`the embedding model is not in ${empty}`);
      }
      expect(opened).toBe(2);
    } finally {
      await absent.close();
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("suggest", () => {
  const cli = async (...argv: string[]) => {
    let err = "";
    const output = {
      out: () => {},
      err: (text: string) => {
        err += text;
      },
    };
    return { code: await run(argv, noUi, output), err };
  };

  it("needs a --body that is not blank, and refuses in one line without the model", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-suggest-cli-"));
    const cacheHome = mkdtempSync(join(tmpdir(), "diffalanche-cache-home-"));
    vi.stubEnv("XDG_CACHE_HOME", cacheHome);
    try {
      await makeSession(dataDir, "alpha", [comment("c_a1")]);
      expect(await cli("suggest", "--data-dir", dataDir)).toEqual({
        code: 1,
        err: "diffalanche: --body is required\n",
      });
      expect(await cli("suggest", "--body", "  ", "--data-dir", dataDir)).toEqual({
        code: 1,
        err: "diffalanche: --body is blank\n",
      });
      const absent = await cli("suggest", "--body", "x", "--data-dir", dataDir);
      expect(absent.code).toBe(1);
      expect(absent.err).toMatch(
        /^diffalanche: the embedding model is not in .*missing or incomplete\n$/,
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  it("refuses where nothing was reviewed, and makes no data directory there", async () => {
    const root = mkdtempSync(join(tmpdir(), "diffalanche-suggest-empty-"));
    try {
      const dataDir = join(root, ".diffalanche");
      expect(await cli("suggest", "--body", "x", "--root", root)).toEqual({
        code: 1,
        err: `diffalanche: no review session in ${dataDir}: there is no history to suggest from\n`,
      });
      expect(await cli("index", "rebuild", "--root", root)).toEqual({
        code: 1,
        err: `diffalanche: no review session in ${dataDir}: there is nothing to index\n`,
      });
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a thread whose module cannot load", () => {
  const broken = new URL("./helpers/throwing-worker.ts", import.meta.url);

  it("is refused as a model that is not there, and the process lives on", async () => {
    const start = startThreadedEmbedder(tmpdir(), broken);
    await expect(start).rejects.toThrow(ModelError);
    await expect(start).rejects.toThrow(
      /^the embedding runtime could not be loaded: .*the runtime is not here/,
    );
  });

  it("answers GET /api/suggest with 503 and the reason", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "diffalanche-suggest-thread-"));
    const service = createSuggestService(dataDir, () => startThreadedEmbedder(dataDir, broken));
    try {
      await makeSession(dataDir, "alpha", [comment("c_a1")]);
      const config = await loadConfig({ root: dataDir, dataDir });
      const app = createApp({
        activity: createActivityLog(),
        config,
        events: createEventStream(),
        review: createReviewService(config),
        ui: noUi,
        suggest: service,
      });
      const response = await app.request("/api/suggest?body=anything");
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("model");
      expect(body.message).toMatch(/the runtime is not here/);
    } finally {
      await service.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
