/** Public watcher/service contracts with injected tree notifications and real isolated storage/git. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, createSession, deleteSession } from "../src/core/domain/index.ts";
import { scan } from "../src/core/index.ts";
import type { Comment } from "../src/core/storage/index.ts";
import { diffCachePath } from "../src/core/storage/index.ts";
import type { Watcher, WatcherEvent, WatcherOptions } from "../src/core/watcher/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../src/core/watcher/index.ts";
import { createEventStream, forwardEvents } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";

const REPO = "repos/core/cargos-api";
const CURRENT = "only-a";
const NAMED = "only-b";
type TreeOptions = Parameters<NonNullable<WatcherOptions["native"]>>[0];

async function fixture(exclude: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-document-handover-"));
  generate({ out: root, seed: 17, profile: PROFILES.small });
  const loaded = await loadConfig({ root });
  const config = { ...loaded, exclude: [...loaded.exclude, ...exclude] };
  writeFileSync(join(root, REPO, "A.ts"), "export const a = 1;\n");
  writeFileSync(join(root, REPO, "B.ts"), "export const b = 1;\n");
  await createSession(config.dataDir, CURRENT, { mode: "head" }, undefined, {
    scope: [{ repo: REPO, paths: ["A.ts"] }],
  });
  await createSession(config.dataDir, NAMED, { mode: "head" }, undefined, {
    scope: [{ repo: REPO, paths: ["B.ts"] }],
    use: false,
  });
  let watcher: Watcher | null = null;
  const service = createReviewService(config, {
    watched: () => watcher?.session() ?? null,
    served: (name, document) => watcher?.served(name, document.session, document.comments),
  });
  await service.document(CURRENT);
  const bus = createEventBus();
  const events: WatcherEvent[] = [];
  const notified: string[] = [];
  const rescans: string[] = [];
  const activity: unknown[] = [];
  const windows = [NAMED];
  const stream = createEventStream(
    undefined,
    (name) => watcher?.left(name),
    () => watcher?.session() ?? null,
    (name, token) => {
      watcher?.follow(name, token);
    },
  );
  const delivered = new Map<string, string[]>();
  for (const session of [null, CURRENT, NAMED]) {
    const frames: string[] = [];
    delivered.set(session ?? "current", frames);
    stream.subscribe({ session, send: (frame) => frames.push(frame.data), end: () => {} });
  }
  forwardEvents(bus, stream);
  const errors: unknown[] = [];
  const trees = new Map<string, TreeOptions>();
  let drained: (() => void) | null = null;
  watcher = await startWatcher({
    config,
    scan: await scan(config.root, config),
    bus,
    activity: createActivityLog({ onRecord: (event) => activity.push(event) }),
    recursive: true,
    debounceMs: 1,
    native: (options) => {
      trees.set(options.dir, options);
      return { polling: false, ready: Promise.resolve(), close: () => {} };
    },
    sessions: () => windows,
    onRescan: (name, cache) => {
      rescans.push(name);
      service.adopt(name, cache);
    },
    onRepositoryChanged: (repo, files) => {
      notified.push(repo);
      service.repositoryChanged(repo, files);
    },
    onSessions: (reviews) => {
      service.sessionsRead(reviews);
      drained?.();
    },
    onDataChanged: service.dataChanged,
    onError: (error) => errors.push(error),
  });
  bus.subscribe((event) => events.push(event));
  async function drain() {
    const end = new Promise<void>((resolve) => {
      drained = resolve;
    });
    trees.get(config.dataDir)?.onChange("reviews");
    await end;
    drained = null;
    expect(errors).toEqual([]);
  }
  return {
    root,
    config,
    service,
    events,
    notified,
    rescans,
    activity,
    delivered,
    windows,
    drain,
    signal: (path: string) => trees.get(join(root, REPO))?.onChange(path),
    servedDocument: async (name: string) => {
      let token = "";
      const body = await service.payload(name, (served) => {
        token = served;
      });
      return { token, body };
    },
    follow: (name: string, token: string) => watcher?.follow(name, token) ?? false,
    left: (name: string) => watcher?.left(name),
    attach: (name: string, token: string) =>
      stream.subscribe({ session: name, served: token, send: () => {}, end: () => {} }),
    edit: (path: string, content: string) => {
      writeFileSync(join(root, REPO, path), content);
      const tree = trees.get(join(root, REPO));
      if (tree !== undefined && !tree.ignore(path, "file")) tree.onChange(path);
    },
    close: async () => {
      stream.close();
      await watcher?.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("review document and stream handover", () => {
  it("notifies a held named scope when only its B path changed outside current A", async () => {
    const run = await fixture();
    try {
      const current = await run.service.document(CURRENT);
      await run.service.payload(NAMED);
      await run.drain();
      const held = await run.service.document(NAMED);
      run.events.length = 0;
      for (const frames of run.delivered.values()) frames.length = 0;
      const cache = readFileSync(diffCachePath(run.config.dataDir, CURRENT));
      run.edit("B.ts", "export const b = 2;\n");
      await run.drain();
      expect(run.notified).toContain(REPO);
      expect(run.events).toContainEqual({
        type: "diff-changed",
        repo: REPO,
        files: ["B.ts"],
        session: NAMED,
      });
      const after = await run.service.document(NAMED);
      expect(after).not.toBe(held);
      expect(after.repositories[0]?.files[0]?.patch).toContain("export const b = 2;");
      expect(await run.service.document(CURRENT)).toBe(current);
      expect(readFileSync(diffCachePath(run.config.dataDir, CURRENT))).toEqual(cache);
      expect(run.rescans).toEqual([]);
      expect(run.activity).toEqual([]);
      expect(run.delivered.get("current")).toEqual([]);
      expect(run.delivered.get(CURRENT)).toEqual([]);
      expect(
        run.delivered.get(NAMED)?.some((frame) => frame.includes('"type":"diff-changed"')),
      ).toBe(true);
    } finally {
      await run.close();
    }
  });

  it("keeps current and named documents for an unrelated C path and an identical A save", async () => {
    const run = await fixture();
    try {
      const current = await run.service.document(CURRENT);
      await run.service.payload(NAMED);
      await run.drain();
      const named = await run.service.document(NAMED);
      run.events.length = 0;
      for (const frames of run.delivered.values()) frames.length = 0;
      run.edit("C.ts", "export const c = 2;\n");
      await run.drain();
      run.edit("A.ts", "export const a = 1;\n");
      await run.drain();
      expect(await run.service.document(CURRENT)).toBe(current);
      expect(await run.service.document(NAMED)).toBe(named);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      expect(run.rescans).toEqual([]);
      expect(run.activity).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it("keeps excluded B out of both the named document and its live notifications", async () => {
    const run = await fixture(["**/B.ts"]);
    try {
      await run.service.payload(NAMED);
      await run.drain();
      const held = await run.service.document(NAMED);
      run.events.length = 0;
      run.edit("B.ts", "export const b = 9;\n");
      await run.drain();
      expect(await run.service.document(NAMED)).toBe(held);
      expect(held.repositories).toEqual([]);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it("reaches a followed scope after more than four held documents evicted its document", async () => {
    const run = await fixture();
    try {
      await run.service.payload(NAMED);
      await run.drain();
      for (let index = 0; index < 5; index += 1) {
        const name = `other-${index}`;
        await createSession(run.config.dataDir, name, { mode: "head" }, undefined, { use: false });
        await run.service.document(name);
      }
      await run.drain();
      run.events.length = 0;
      for (const frames of run.delivered.values()) frames.length = 0;
      run.edit("B.ts", "export const b = 4;\n");
      await run.drain();
      expect(run.events).toContainEqual({
        type: "diff-changed",
        repo: REPO,
        files: ["B.ts"],
        session: NAMED,
      });
      expect(run.delivered.get("current")).toEqual([]);
      expect(
        run.delivered.get(NAMED)?.some((frame) => frame.includes('"type":"diff-changed"')),
      ).toBe(true);
      expect(run.rescans).toEqual([]);
      expect(run.activity).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it("treats git control paths as repository-wide without writing or notifying current A", async () => {
    const run = await fixture();
    try {
      await run.service.payload(NAMED);
      await run.drain();
      run.events.length = 0;
      for (const frames of run.delivered.values()) frames.length = 0;
      run.signal(".git/index.lock");
      await run.drain();
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      run.signal(".git/HEAD");
      await run.drain();
      expect(run.events).toContainEqual({
        type: "diff-changed",
        repo: REPO,
        files: [".git/HEAD"],
        session: NAMED,
      });
      expect(run.delivered.get("current")).toEqual([]);
      expect(run.rescans).toEqual([]);
      expect(run.activity).toEqual([]);
    } finally {
      await run.close();
    }
  });
  it("does not turn an abandoned document into the next unserved window's baseline", async () => {
    const run = await fixture();
    try {
      run.windows.length = 0;
      await run.service.payload(NAMED);
      const history = await addComment(run.config.dataDir, NAMED, {
        severity: "nit",
        body: "written while its window never opened",
        role: "human",
        author: "human",
      });
      await run.drain();
      run.events.length = 0;
      run.windows.push(NAMED);
      await run.drain();
      expect(
        run.events.filter((event) => event.type === "comment-added" && event.id === history.id),
      ).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it("keeps the next document token when an older stream ends late", async () => {
    const run = await fixture();
    try {
      run.windows.length = 0;
      const old = await run.servedDocument(NAMED);
      expect(run.follow(NAMED, old.token)).toBe(true);
      const next = await run.servedDocument(NAMED);
      run.left(NAMED);
      const written = await addComment(run.config.dataDir, NAMED, {
        severity: "nit",
        body: "after next document",
        role: "human",
        author: "human",
      });
      expect(run.follow(NAMED, next.token)).toBe(true);
      run.windows.push(NAMED);
      await run.drain();
      expect(run.events).toContainEqual({ type: "comment-added", session: NAMED, id: written.id });
    } finally {
      await run.close();
    }
  });

  it("consumes two exact documents by their served order rather than their subscription order", async () => {
    const run = await fixture();
    try {
      run.windows.length = 0;
      const earlier = await run.servedDocument(NAMED);
      const between = await addComment(run.config.dataDir, NAMED, {
        severity: "nit",
        body: "between documents",
        role: "human",
        author: "human",
      });
      await run.drain();
      const later = await run.servedDocument(NAMED);
      expect(JSON.parse(earlier.body).comments).toEqual([]);
      expect(JSON.parse(later.body).comments.map((one: Comment) => one.id)).toContain(between.id);
      expect(run.follow(NAMED, later.token)).toBe(true);
      expect(run.follow(NAMED, earlier.token)).toBe(true);
      run.windows.push(NAMED);
      await run.drain();
      expect(
        run.events.filter((event) => event.type === "comment-added" && event.id === between.id),
      ).toHaveLength(1);
    } finally {
      await run.close();
    }
  });

  it("matches the cached response body instead of a newer storage snapshot", async () => {
    const run = await fixture();
    try {
      run.windows.length = 0;
      const before = await run.servedDocument(NAMED);
      const written = await addComment(run.config.dataDir, NAMED, {
        severity: "nit",
        body: "after cached body",
        role: "human",
        author: "human",
      });
      const cached = await run.servedDocument(NAMED);
      expect(cached.body).toBe(before.body);
      expect(JSON.parse(cached.body).comments).toEqual([]);
      const detach = run.attach(NAMED, cached.token);
      run.windows.push(NAMED);
      await run.drain();
      expect(run.events).toContainEqual({ type: "comment-added", session: NAMED, id: written.id });
      detach();
    } finally {
      await run.close();
    }
  });

  it("refuses mismatched, duplicate, expired and evicted tokens without adopting their history", async () => {
    const run = await fixture();
    try {
      run.windows.length = 0;
      const own = await run.servedDocument(NAMED);
      expect(run.follow(CURRENT, own.token)).toBe(false);
      expect(run.follow(NAMED, own.token)).toBe(true);
      expect(run.follow(NAMED, own.token)).toBe(false);
      run.left(NAMED);
      const expired = await run.servedDocument(NAMED);
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
      try {
        expect(run.follow(NAMED, expired.token)).toBe(false);
      } finally {
        clock.mockRestore();
      }
      const tokens: string[] = [];
      for (let index = 0; index < 33; index += 1)
        tokens.push((await run.servedDocument(NAMED)).token);
      expect(run.follow(NAMED, tokens[0] ?? "")).toBe(false);
      expect(run.follow(NAMED, tokens[32] ?? "")).toBe(true);
      run.left(NAMED);
      const history = await addComment(run.config.dataDir, NAMED, {
        severity: "nit",
        body: "after discarded documents",
        role: "human",
        author: "human",
      });
      await run.drain();
      run.windows.push(NAMED);
      await run.drain();
      expect(
        run.events.filter((event) => event.type === "comment-added" && event.id === history.id),
      ).toEqual([]);
    } finally {
      await run.close();
    }
  });

  it("names a disappeared task so another window can remove its open history row", async () => {
    const run = await fixture();
    try {
      await run.service.payload(NAMED);
      await run.drain();
      run.events.length = 0;
      await deleteSession(run.config.dataDir, NAMED, { role: "human" });
      await run.drain();
      expect(run.events).toContainEqual({ type: "sessions-changed", name: NAMED, status: null });
      expect(run.events).toContainEqual({ type: "session-changed", name: NAMED });
    } finally {
      await run.close();
    }
  });
});

describe("scoped repository frames", () => {
  it("filters live and replay frames and follows the current pointer", () => {
    let current = "A";
    const events = createEventStream(undefined, undefined, () => current);
    const received: string[] = [];
    events.subscribe({ session: null, send: (frame) => received.push(frame.data), end: () => {} });
    const bus = createEventBus();
    forwardEvents(bus, events);
    bus.emit({ type: "diff-changed", repo: REPO, files: ["B.ts"], session: "B" });
    expect(received).toEqual([]);
    expect(events.since(0, null).frames).toEqual([]);
    expect(events.since(0, "B").frames).toHaveLength(1);
    current = "B";
    expect(events.since(0, null).frames).toHaveLength(1);
    bus.emit({ type: "diff-changed", repo: REPO, files: ["B.ts"], session: "B" });
    expect(received).toHaveLength(1);
    bus.emit({ type: "diff-changed", repo: REPO, files: ["B.ts"] });
    expect(received).toHaveLength(2);
    expect(events.since(0, "A").frames).toHaveLength(1);
    events.close();
  });
});
