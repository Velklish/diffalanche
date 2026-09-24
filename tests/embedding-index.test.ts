/** `src/core/ml/index` and `index rebuild` / `index status` with an embedder that is a function
 * of the text and nothing else; the half with the model is tests/embedding-model.test.ts. */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import { addComment, deleteSession, reply } from "../src/core/domain/index.ts";
import { modelDirectory } from "../src/core/ml/embed/cache.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "../src/core/ml/embed/model.ts";
import type { EmbeddingIndex, IndexEntry } from "../src/core/ml/index/index.ts";
import {
  indexPath,
  indexStatus,
  nearest,
  readIndex,
  updateIndex,
} from "../src/core/ml/index/index.ts";
import { writeIndex } from "../src/core/ml/index/store.ts";
import { suggest } from "../src/core/ml/suggest/index.ts";
import {
  commentsPath,
  readComments,
  sessionDir,
  writeComments,
  writeReview,
} from "../src/core/storage/index.ts";
import { dataIgnore } from "../src/core/watcher/index.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { comment, makeSession, review } from "./helpers/session.ts";

const noUi: UiAssets = { read: async () => null };
const DIMENSIONS = 8;

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await run(argv, noUi, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/** A unit vector made of the text's characters: equal texts, equal vectors, and nothing else. */
function vectorOf(text: string): Float32Array {
  const vector = new Float32Array(DIMENSIONS);
  for (let i = 0; i < text.length; i += 1) {
    vector[i % DIMENSIONS] = (vector[i % DIMENSIONS] as number) + text.charCodeAt(i) * (i + 1);
  }
  const norm = Math.hypot(...vector);
  return vector.map((value) => value / norm);
}

function fakeEmbedder(identity = embeddingIdentity()) {
  const embedded: string[] = [];
  return {
    embedded,
    model: { ...EMBEDDING_MODEL, dimensions: DIMENSIONS },
    identity,
    embed: async (texts: string[]) => {
      embedded.push(...texts);
      return texts.map(vectorOf);
    },
  };
}

/** The JSON line of `index.bin`, as it is on disk. */
function headerOf(dataDir: string): string {
  const bytes = readFileSync(indexPath(dataDir));
  return bytes.toString("utf8", 0, bytes.indexOf(0x0a));
}

function vectorFor(index: EmbeddingIndex, session: string, id: string): number[] {
  const row = index.entries.findIndex((entry) => entry.session === session && entry.id === id);
  expect(row, `${session}/${id} is in the index`).toBeGreaterThan(-1);
  return Array.from(index.vectors.subarray(row * index.dimensions, (row + 1) * index.dimensions));
}

describe("the index with an embedder that is a function of the text", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "diffalanche-index-"));
    await makeSession(dataDir, "alpha", [
      comment("c_a1", { body: "the null check is unreachable", severity: "nit" }),
      comment("c_a2", { body: "this allocates on every request", severity: "warning" }),
    ]);
    await makeSession(dataDir, "beta", [
      comment("c_b1", { body: "the cache key misses the region", severity: "critical", line: 7 }),
    ]);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("indexes every comment of every session, and reads back what it wrote", async () => {
    const fake = fakeEmbedder();
    const { index, update } = await updateIndex(dataDir, fake);
    expect(update).toMatchObject({ embedded: 3, kept: 0, dropped: 0, sessions: 2 });
    expect(update.rebuilt).toBe("no index yet");
    expect(index.entries.map((entry) => `${entry.session}/${entry.id}`)).toEqual([
      "alpha/c_a1",
      "alpha/c_a2",
      "beta/c_b1",
    ]);
    expect(index.entries[2]).toMatchObject({
      severity: "critical",
      repo: "repos/core/cargos-api",
      path: "src/a.ts",
      line: 7,
      body: "the cache key misses the region",
    });

    const { index: read, problem } = await readIndex(dataDir);
    expect(problem).toBeNull();
    expect(read?.entries).toEqual(index.entries);
    expect(read?.identity).toEqual(embeddingIdentity());
    expect(Array.from(read?.vectors ?? [])).toEqual(Array.from(index.vectors));
  });

  it("reads no comments and writes nothing when no comments.json changed", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    const before = statSync(indexPath(dataDir)).mtimeMs;
    const fake = fakeEmbedder();
    const { update } = await updateIndex(dataDir, fake);
    expect(update).toMatchObject({ embedded: 0, kept: 3, dropped: 0, rebuilt: null });
    expect(fake.embedded).toEqual([]);
    expect(statSync(indexPath(dataDir)).mtimeMs).toBe(before);
  });

  it("hands back the index it was given when nothing changed, not a copy of it", async () => {
    const { index } = await updateIndex(dataDir, fakeEmbedder());
    const again = await updateIndex(dataDir, fakeEmbedder(), { current: index });
    expect(again.index).toBe(index);
    await addComment(dataDir, "beta", {
      severity: "nit",
      body: "one more",
      author: "a",
      role: "agent",
    });
    const changed = await updateIndex(dataDir, fakeEmbedder(), { current: index });
    expect(changed.index).not.toBe(index);
    expect(changed.update).toMatchObject({ embedded: 1, kept: 3 });
  });

  it("embeds a new comment and an edited text, and nothing else", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    await addComment(dataDir, "beta", {
      severity: "question",
      body: "why is the list sorted here?",
      author: "claude",
      role: "agent",
    });
    const edited = await readComments(dataDir, "alpha");
    await writeComments(
      dataDir,
      "alpha",
      edited.map((one) => (one.id === "c_a2" ? { ...one, body: "hoist the default" } : one)),
    );

    const fake = fakeEmbedder();
    const { index, update } = await updateIndex(dataDir, fake);
    expect(fake.embedded.sort()).toEqual(["hoist the default", "why is the list sorted here?"]);
    // The edited comment is one embedded and one dropped: its old vector went.
    expect(update).toMatchObject({ embedded: 2, kept: 2, dropped: 1 });
    expect(vectorFor(index, "alpha", "c_a2")).toEqual(Array.from(vectorOf("hoist the default")));
    expect(index.entries.find((entry) => entry.body.startsWith("why"))?.severity).toBe("question");
  });

  it("reads a session again after a reply and embeds nothing for it", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    const comments = await readComments(dataDir, "beta");
    await writeComments(dataDir, "beta", [
      {
        ...(comments[0] as (typeof comments)[number]),
        replies: [
          {
            id: "r_1",
            author: "claude",
            role: "agent",
            body: "Fixed.",
            createdAt: "2026-09-02T00:00:00.000Z",
          },
        ],
      },
    ]);
    const fake = fakeEmbedder();
    const { update } = await updateIndex(dataDir, fake);
    expect(update).toMatchObject({ embedded: 0, kept: 3, dropped: 0 });
    // The new size is recorded, so the update after it reads nothing at all.
    const again = await updateIndex(dataDir, fake);
    expect(again.update).toMatchObject({ embedded: 0, kept: 3 });
    expect(fake.embedded).toEqual([]);
  });

  it("drops the comments of a session that is gone", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    await rm(sessionDir(dataDir, "alpha"), { recursive: true });
    const { index, update } = await updateIndex(dataDir, fakeEmbedder());
    expect(update).toMatchObject({ embedded: 0, kept: 1, dropped: 2, sessions: 1 });
    expect(index.entries.map((entry) => entry.id)).toEqual(["c_b1"]);
  });

  it("leaves a deleted session to its next reader, and no reader returns its comments", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    // `deleteSession` touches no index (DA-40): until something reads it, the entries are gone ones.
    await deleteSession(dataDir, "beta", { role: "human" });
    expect(await indexStatus(dataDir, embeddingIdentity())).toMatchObject({ gone: 1 });

    const fake = fakeEmbedder();
    const answer = await suggest(dataDir, fake, "the cache key misses the region");
    expect(answer.update).toMatchObject({ embedded: 0, dropped: 1, sessions: 1 });
    expect(answer.suggestions.map((one) => one.session)).toEqual(["alpha", "alpha"]);
    expect(await indexStatus(dataDir, embeddingIdentity())).toMatchObject({ gone: 0 });
  });

  it("embeds every comment again when the model, the runtime or the platform changed", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    for (const change of [
      { revision: "0000" },
      { runtime: "onnxruntime-node 9.9.9" },
      { platform: `not-${embeddingIdentity().platform}` },
    ]) {
      const fake = fakeEmbedder({ ...embeddingIdentity(), ...change });
      const { update } = await updateIndex(dataDir, fake);
      expect(update.rebuilt, JSON.stringify(change)).toMatch(/^built by multilingual-e5-small/);
      expect(update.embedded).toBe(3);
      await updateIndex(dataDir, fakeEmbedder());
    }
  });

  it("keeps what it had of a comments.json that no longer parses, and says so", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    writeFileSync(join(sessionDir(dataDir, "alpha"), "comments.json"), "{ not json");
    const { index, update } = await updateIndex(dataDir, fakeEmbedder());
    expect(update.warnings).toEqual([
      expect.stringContaining("its comments were not indexed again"),
    ]);
    expect(index.entries.map((entry) => entry.id)).toEqual(["c_a1", "c_a2", "c_b1"]);
    // Read again on every update, and the index is not rewritten for it meanwhile.
    const before = statSync(indexPath(dataDir)).mtimeMs;
    const again = await updateIndex(dataDir, fakeEmbedder());
    expect(again.update.warnings).toHaveLength(1);
    expect(statSync(indexPath(dataDir)).mtimeMs).toBe(before);
    // Nor are its entries gone: the update keeps them.
    expect(await indexStatus(dataDir, embeddingIdentity())).toMatchObject({ missing: 0, gone: 0 });
  });

  it("keeps who chose each severity, and takes a confirmation without embedding", async () => {
    const left = await addComment(dataDir, "beta", {
      severity: "nit",
      severitySource: "auto",
      body: "left to the model",
      author: "kim.p",
      role: "human",
    });
    const { index } = await updateIndex(dataDir, fakeEmbedder());
    expect(index.entries.map((entry) => `${entry.id} ${entry.severitySource}`)).toEqual([
      "c_a1 manual",
      "c_a2 manual",
      "c_b1 manual",
      `${left.id} auto`,
    ]);
    await reply(dataDir, "beta", left.id, {
      author: "claude",
      role: "agent",
      body: "agreed",
      confirmSeverity: true,
    });
    const fake = fakeEmbedder();
    const again = await updateIndex(dataDir, fake);
    expect(fake.embedded).toEqual([]);
    const read = (await readIndex(dataDir)).index;
    for (const entries of [again.index.entries, read?.entries ?? []]) {
      expect(entries.find((entry) => entry.id === left.id)?.severitySource).toBe(
        "confirmed:claude",
      );
    }
  });

  it("takes the sources an index written without them lacks, and embeds nothing", async () => {
    const left = await addComment(dataDir, "beta", {
      severity: "nit",
      severitySource: "auto",
      body: "left to the model",
      author: "kim.p",
      role: "human",
    });
    const { index } = await updateIndex(dataDir, fakeEmbedder());
    // What a build from before the source writes: the same index with no severitySource.
    const older = index.entries.map(({ severitySource: _, ...entry }) => entry);
    await writeIndex(dataDir, { ...index, entries: older as IndexEntry[] });
    expect(headerOf(dataDir)).not.toContain("severitySource");
    const { index: read, problem } = await readIndex(dataDir);
    expect(problem).toBeNull();
    // Read as storage reads a comment without the field, and every session with entries unread.
    expect(read?.entries.every((entry) => entry.severitySource === "manual")).toBe(true);
    expect(read?.sessions).toEqual({});

    const fake = fakeEmbedder();
    const { index: taken, update } = await updateIndex(dataDir, fake);
    expect(fake.embedded).toEqual([]);
    expect(update).toMatchObject({ embedded: 0, kept: 4, dropped: 0, rebuilt: null });
    expect(taken.entries.find((entry) => entry.id === left.id)?.severitySource).toBe("auto");
    expect(headerOf(dataDir)).toContain('"severitySource":"auto"');
    expect(Object.keys(taken.sessions)).toEqual(["alpha", "beta"]);

    // A source that is none of the three is a hand-edited file: rebuilt, not half-read.
    const edited = index.entries.map((entry) => ({ ...entry, severitySource: "confirmed:" }));
    await writeIndex(dataDir, { ...index, entries: edited as IndexEntry[] });
    expect((await readIndex(dataDir)).problem).toContain(
      "entries[0].severitySource: not a severity source",
    );
  });

  it("keeps an older index's entries of a broken comments.json `manual` until it is fixed", async () => {
    const left = await addComment(dataDir, "beta", {
      severity: "nit",
      severitySource: "auto",
      body: "left to the model",
      author: "kim.p",
      role: "human",
    });
    const { index } = await updateIndex(dataDir, fakeEmbedder());
    const older = index.entries.map(({ severitySource: _, ...entry }) => entry);
    await writeIndex(dataDir, { ...index, entries: older as IndexEntry[] });
    const good = readFileSync(commentsPath(dataDir, "beta"), "utf8");
    writeFileSync(commentsPath(dataDir, "beta"), "{ not json");

    const broken = await updateIndex(dataDir, fakeEmbedder());
    expect(broken.update.warnings).toHaveLength(1);
    expect(broken.index.entries.find((entry) => entry.id === left.id)?.severitySource).toBe(
      "manual",
    );
    expect(Object.keys(broken.index.sessions)).toEqual(["alpha"]);
    expect(Object.keys((await readIndex(dataDir)).index?.sessions ?? {})).toEqual(["alpha"]);

    writeFileSync(commentsPath(dataDir, "beta"), good);
    const fake = fakeEmbedder();
    const fixed = await updateIndex(dataDir, fake);
    expect(fake.embedded).toEqual([]);
    expect(fixed.index.entries.find((entry) => entry.id === left.id)?.severitySource).toBe("auto");
    expect(Object.keys(fixed.index.sessions)).toEqual(["alpha", "beta"]);
  });

  it("lists a comment the model labelled, and leaves it out of the vote until confirmed", async () => {
    // The same text as beta's critical, labelled `nit` by the model and nearer in the row order.
    const left = await addComment(dataDir, "alpha", {
      severity: "nit",
      severitySource: "auto",
      body: "the cache key misses the region",
      author: "kim.p",
      role: "human",
    });
    const body = "the cache key misses the region";
    const first = await suggest(dataDir, fakeEmbedder(), body);
    expect(first.suggestions.slice(0, 2).map((one) => `${one.id} ${one.severitySource}`)).toEqual([
      `${left.id} auto`,
      "c_b1 manual",
    ]);
    expect(first.severity?.severity).toBe("critical");

    await reply(dataDir, "alpha", left.id, {
      author: "claude",
      role: "agent",
      body: "agreed",
      confirmSeverity: true,
    });
    // Confirmed, it votes like any other: a tie at the same text, and the nearer row wins it.
    expect((await suggest(dataDir, fakeEmbedder(), body)).severity?.severity).toBe("nit");
  });

  it("keeps what it had of a comments.json its stat is refused, and says so", async () => {
    // A session with no comments.json yet: its fingerprint is `null`, which a refusal must not match.
    await writeReview(dataDir, "gamma", review("gamma"));
    const { index: first } = await updateIndex(dataDir, fakeEmbedder());
    const before = statSync(indexPath(dataDir)).mtimeMs;
    // The listing reads review.json and passes the session; the link's target is behind a file.
    writeFileSync(join(dataDir, "plain"), "not a directory\n");
    const link = (session: string) => {
      rmSync(commentsPath(dataDir, session), { force: true });
      symlinkSync(join(dataDir, "plain", "comments.json"), commentsPath(dataDir, session));
      return (
        `${commentsPath(dataDir, session)}: could not be read: ` +
        "a file is in the way of one of its parents; its comments were not indexed again"
      );
    };
    const gamma = link("gamma");
    const alone = await updateIndex(dataDir, fakeEmbedder(), { current: first });
    expect(alone.update.warnings).toEqual([gamma]);

    const alpha = link("alpha");
    const { index, update } = await updateIndex(dataDir, fakeEmbedder());
    expect(update.warnings).toEqual([alpha, gamma]);
    expect(index.entries.map((entry) => entry.id)).toEqual(["c_a1", "c_a2", "c_b1"]);
    const again = await updateIndex(dataDir, fakeEmbedder(), { current: index });
    expect(again.update.warnings).toEqual([alpha, gamma]);
    expect(statSync(indexPath(dataDir)).mtimeMs).toBe(before);
  });

  it.skipIf(process.getuid?.() === 0)(
    "says a comments.json behind a directory it may not enter is refused, not its errno",
    async () => {
      await updateIndex(dataDir, fakeEmbedder());
      const locked = join(dataDir, "locked");
      mkdirSync(locked);
      rmSync(commentsPath(dataDir, "alpha"));
      symlinkSync(join(locked, "comments.json"), commentsPath(dataDir, "alpha"));
      chmodSync(locked, 0o000);
      try {
        const { update } = await updateIndex(dataDir, fakeEmbedder());
        expect(update.warnings).toEqual([
          `${commentsPath(dataDir, "alpha")}: could not be read: permission denied; ` +
            "its comments were not indexed again",
        ]);
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it("reads a session again when only the inode of its comments.json changed", async () => {
    const { index } = await updateIndex(dataDir, fakeEmbedder());
    const print = index.sessions.alpha as { mtimeMs: number; size: number; ino: number };
    // The same time and size and another file: what one atomic write inside a tick looks like.
    const stale = {
      ...index,
      sessions: { ...index.sessions, alpha: { ...print, ino: print.ino + 1 } },
    };
    const again = await updateIndex(dataDir, fakeEmbedder(), { current: stale });
    expect(again.index).not.toBe(stale);
    expect(again.index.sessions.alpha).toEqual(print);
  });

  it("writes nothing, and makes no index directory, where there is no session", async () => {
    const empty = mkdtempSync(join(tmpdir(), "diffalanche-index-empty-"));
    try {
      const { index, update } = await updateIndex(empty, fakeEmbedder());
      expect(index.entries).toEqual([]);
      expect(update).toMatchObject({ embedded: 0, sessions: 0 });
      expect(readdirSync(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("is not watched: a write of the index wakes no reload of the sessions", () => {
    expect(dataIgnore("index", "dir")).toBe(true);
    expect(dataIgnore("index/index.bin", "file")).toBe(true);
    expect(dataIgnore("index/index.bin.tmp-9e7c", "file")).toBe(true);
    expect(dataIgnore("reviews/index/comments.json", "file")).toBe(false);
  });

  it("reads a torn file as no index with the reason, and the next update rebuilds it", async () => {
    await updateIndex(dataDir, fakeEmbedder());
    const path = indexPath(dataDir);
    writeFileSync(path, `${JSON.stringify({ version: 2 })}`);
    expect((await readIndex(dataDir)).problem).toMatch(/no end of line/);
    writeFileSync(path, `${JSON.stringify({ version: 1 })}\n`);
    expect((await readIndex(dataDir)).problem).toMatch(/version: expected 2/);

    const { update } = await updateIndex(dataDir, fakeEmbedder());
    expect(update.rebuilt).toMatch(/^unreadable: .*version: expected 2/);
    expect(update.embedded).toBe(3);
    // Four floats short: the vectors are checked against the entries, not trusted.
    const whole = readFileSync(path);
    writeFileSync(path, whole.subarray(0, whole.length - 16));
    expect((await readIndex(dataDir)).problem).toMatch(/expected 3 of 8 floats/);
  });

  it("orders by cosine, stops at k, and keeps to the sessions it is given", async () => {
    const { index } = await updateIndex(dataDir, fakeEmbedder());
    const query = vectorOf("this allocates on every request");
    const all = nearest(index, query, { k: 2 });
    expect(all.map((one) => one.id)).toEqual(["c_a2", expect.any(String)]);
    expect(all[0]?.similarity).toBeCloseTo(1, 5);
    expect((all[0]?.similarity ?? 0) >= (all[1]?.similarity ?? 0)).toBe(true);
    expect(nearest(index, query, { k: 10 })).toHaveLength(3);
    expect(nearest(index, query, { k: 10, sessions: ["beta"] }).map((one) => one.id)).toEqual([
      "c_b1",
    ]);
    expect(nearest(index, query, { k: 10, sessions: [] })).toEqual([]);
  });

  it("says what the index is missing without the model", async () => {
    const build = embeddingIdentity();
    expect(await indexStatus(dataDir, build)).toMatchObject({ present: false, missing: 3 });
    await updateIndex(dataDir, fakeEmbedder());
    expect(await indexStatus(dataDir, build)).toMatchObject({
      present: true,
      comments: 3,
      sessions: 2,
      missing: 0,
      gone: 0,
    });
    await rm(sessionDir(dataDir, "beta"), { recursive: true });
    await addComment(dataDir, "alpha", {
      severity: "nit",
      body: "one more",
      author: "a",
      role: "agent",
    });
    expect(await indexStatus(dataDir, build)).toMatchObject({ missing: 1, gone: 1 });
    expect(
      await indexStatus(dataDir, { ...build, platform: `not-${build.platform}` }),
    ).toMatchObject({
      missing: 3,
      gone: 0,
    });
  });

  it("prints the status, and the same as JSON", async () => {
    const absent = await cli("index", "status", "--data-dir", dataDir);
    expect(absent.code).toBe(0);
    expect(absent.out).toContain("absent: `diffalanche index rebuild` builds it");

    await updateIndex(dataDir, fakeEmbedder());
    const { code, out } = await cli("index", "status", "--data-dir", dataDir);
    expect(code).toBe(0);
    expect(out).toContain(`index     ${indexPath(dataDir)}`);
    expect(out).toContain(
      "built by  multilingual-e5-small @ 761b726dd34f, onnxruntime-node 1.30.0",
    );
    expect(out).toContain("holds     3 comments of 2 review sessions");
    expect(out).toContain("state     current");

    await addComment(dataDir, "alpha", {
      severity: "nit",
      body: "one more",
      author: "a",
      role: "agent",
    });
    expect((await cli("index", "status", "--data-dir", dataDir)).out).toContain(
      "state     1 comment to embed, 0 entries to drop",
    );
    const json = JSON.parse((await cli("index", "status", "--json", "--data-dir", dataDir)).out);
    expect(json.index).toMatchObject({ present: true, comments: 3, missing: 1, gone: 0 });
  });

  it("refuses `index rebuild` in one line when the model is not in the cache", async () => {
    const cacheHome = mkdtempSync(join(tmpdir(), "diffalanche-cache-home-"));
    vi.stubEnv("XDG_CACHE_HOME", cacheHome);
    try {
      const { code, out, err } = await cli("index", "rebuild", "--data-dir", dataDir);
      expect(code).toBe(1);
      expect(out).toBe("");
      expect(err).toBe(
        `diffalanche: the embedding model is not in ${modelDirectory(cacheHome, EMBEDDING_MODEL)}: ` +
          "model_quantized.onnx, tokenizer.json, tokenizer_config.json missing or incomplete; " +
          "`bun run model:fetch` puts it there\n",
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  it("searches 10 000 vectors of the model's width within 50 ms", () => {
    const size = 10_000;
    const width = EMBEDDING_MODEL.dimensions;
    const vectors = new Float32Array(size * width).map(() => Math.random() - 0.5);
    const index: EmbeddingIndex = {
      identity: embeddingIdentity(),
      dimensions: width,
      updatedAt: "",
      sessions: {},
      entries: Array.from({ length: size }, (_, row) => ({
        session: `s${row % 50}`,
        id: `c_${row}`,
        severity: "nit" as const,
        severitySource: "manual" as const,
        repo: null,
        path: null,
        line: null,
        body: "",
      })),
      vectors,
    };
    const query = vectors.slice(0, width);
    const times: number[] = [];
    for (let run = 0; run < 11; run += 1) {
      const started = performance.now();
      nearest(index, query, { k: 10 });
      times.push(performance.now() - started);
    }
    // The median of eleven: one run the machine took away is not the search's time.
    expect(times.sort((a, b) => a - b)[5]).toBeLessThan(50);
  });
});
