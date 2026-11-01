/** DA-56.12: a held document's first subscription needs scope before any later data burst. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession, setScope } from "../src/core/domain/index.ts";
import { scan } from "../src/core/index.ts";
import * as storage from "../src/core/storage/index.ts";
import { diffCachePath } from "../src/core/storage/index.ts";
import type { Watcher, WatcherEvent, WatcherOptions } from "../src/core/watcher/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../src/core/watcher/index.ts";
import { createEventStream, forwardEvents } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";

const REPO = "repos/core/cargos-api";
const A = "only-a";
const B = "only-b";
type TreeOptions = Parameters<NonNullable<WatcherOptions["native"]>>[0];

function barrier() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-followed-scope-"));
  generate({ out: root, seed: 17, profile: PROFILES.small });
  const config = await loadConfig({ root });
  for (const path of ["A.ts", "B.ts", "C.ts"])
    writeFileSync(join(root, REPO, path), `export const ${path[0]?.toLowerCase()} = 1;\n`);
  await createSession(config.dataDir, A, { mode: "head" }, undefined, {
    scope: [{ repo: REPO, paths: ["A.ts"] }],
  });
  await createSession(config.dataDir, B, { mode: "head" }, undefined, {
    scope: [{ repo: REPO, paths: ["B.ts"] }],
    use: false,
  });
  let watcher: Watcher | null = null;
  const service = createReviewService(config, {
    watched: () => watcher?.session() ?? null,
    served: (name, document) => watcher?.served(name, document.session, document.comments),
  });
  await service.document(A);
  const bus = createEventBus();
  const events: WatcherEvent[] = [];
  const currentFrames: unknown[] = [];
  const namedFrames: unknown[] = [];
  const rescans: string[] = [];
  const activity: unknown[] = [];
  const errors: unknown[] = [];
  const trees = new Map<string, TreeOptions>();
  let dataDone = barrier();
  let repoDone = barrier();
  const stream = createEventStream(
    undefined,
    (name) => watcher?.left(name),
    () => watcher?.session() ?? null,
    (name, token) => {
      watcher?.follow(name, token);
    },
  );
  stream.subscribe({ session: null, send: (frame) => currentFrames.push(frame), end: () => {} });
  forwardEvents(bus, stream);
  bus.subscribe((event) => events.push(event));
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
    sessions: stream.sessions,
    onRescan: (name, cache) => {
      rescans.push(name);
      service.adopt(name, cache);
    },
    onRepositoryChanged: (repo, files) => {
      service.repositoryChanged(repo, files);
      repoDone.resolve();
    },
    onSessions: (reviews) => {
      service.sessionsRead(reviews);
      dataDone.resolve();
    },
    onDataChanged: service.dataChanged,
    onError: (error) => errors.push(error),
  });
  async function lockBurst() {
    dataDone = barrier();
    const path = `reviews/${B}/.lock`;
    const tree = trees.get(config.dataDir);
    expect(tree?.ignore(path, "dir")).toBe(false);
    tree?.onChange(path);
    await dataDone.promise;
  }
  let token = "";
  const body = await service.payload(B, (value) => {
    token = value;
  });
  expect(existsSync(diffCachePath(config.dataDir, B))).toBe(true);
  expect(stream.sessions()).toEqual([]);
  await lockBurst();
  const held = await service.document(B);
  const currentCache = readFileSync(diffCachePath(config.dataDir, A));
  return {
    config,
    service,
    token,
    events,
    namedFrames,
    lockBurst,
    attach: (served?: string, name = B) =>
      stream.subscribe({
        session: name,
        ...(served === undefined ? {} : { served }),
        send: (frame) => namedFrames.push(frame),
        end: () => {},
      }),
    onopenRead: async () => {
      expect(await service.payload(B)).toBe(body);
      expect(await service.document(B)).toBe(held);
    },
    edit: async (path: string, value: number) => {
      repoDone = barrier();
      writeFileSync(join(root, REPO, path), `export const ${path[0]?.toLowerCase()} = ${value};\n`);
      trees.get(join(root, REPO))?.onChange(path);
      await repoDone.promise;
    },
    negatives: () => {
      expect(currentFrames).toEqual([]);
      expect(rescans).toEqual([]);
      expect(activity).toEqual([]);
      expect(errors).toEqual([]);
      expect(readFileSync(diffCachePath(config.dataDir, A))).toEqual(currentCache);
    },
    close: async () => {
      stream.close();
      await watcher?.close();
      rmSync(root, { recursive: true, force: true });
      expect(existsSync(root)).toBe(false);
    },
  };
}

describe("a newly followed held scope", () => {
  for (const mode of ["valid token", "no token", "expired token"] as const) {
    it(`notifies the first B edit after ${mode} join without a later data burst`, async () => {
      const run = await fixture();
      try {
        const clock =
          mode === "expired token"
            ? vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001)
            : null;
        run.attach(mode === "no token" ? undefined : run.token);
        clock?.mockRestore();
        await run.onopenRead();
        await run.edit("B.ts", 2);
        const first = run.events.filter(
          (event) => event.type === "diff-changed" && event.session === B,
        );
        run.negatives();
        // A real data burst is a separate positive control, not setup for the measured first edit.
        await run.lockBurst();
        await run.edit("B.ts", 3);
        const total = run.events.filter(
          (event) => event.type === "diff-changed" && event.session === B,
        );
        expect(total.length - first.length).toBe(1);
        run.negatives();
        expect(first).toHaveLength(1);
        expect(run.namedFrames).toHaveLength(2);
      } finally {
        vi.restoreAllMocks();
        await run.close();
      }
    });
  }

  for (const reconnect of [false, true]) {
    it(`reads actual scope instead of a stale held B document on ${reconnect ? "reconnect" : "token join"}`, async () => {
      const run = await fixture();
      try {
        if (reconnect) {
          const detach = run.attach(run.token);
          await run.onopenRead();
          await run.lockBurst();
          detach();
        }
        await setScope(run.config.dataDir, B, [{ repo: REPO, paths: ["C.ts"] }], [REPO]);
        run.events.length = 0;
        run.namedFrames.length = 0;
        run.attach(reconnect ? undefined : run.token);
        await run.edit("B.ts", 2);
        expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
        await run.edit("C.ts", 2);
        expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
          { type: "diff-changed", repo: REPO, files: ["C.ts"], session: B },
        ]);
        run.negatives();
        await run.lockBurst();
        expect(
          run.events.filter((event) => event.type === "session-changed" && event.name === B),
        ).toHaveLength(1);
      } finally {
        await run.close();
      }
    });
  }

  it("keeps an unknown joined task silent instead of treating it as whole-root scope", async () => {
    const run = await fixture();
    try {
      run.attach(undefined, "unknown-task");
      await run.edit("B.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      expect(run.namedFrames).toEqual([]);
      run.negatives();
    } finally {
      await run.close();
    }
  });

  it("routes a known whole-root scope instead of treating null as an unreadable scope", async () => {
    const run = await fixture();
    try {
      await setScope(run.config.dataDir, B, null, [REPO]);
      run.attach(run.token);
      await run.edit("C.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
        { type: "diff-changed", repo: REPO, files: ["C.ts"], session: B },
      ]);
      run.negatives();
    } finally {
      await run.close();
    }
  });

  it("keeps unreadable join metadata silent even when its document token was valid", async () => {
    const run = await fixture();
    const actual = storage.readReview;
    const read = vi
      .spyOn(storage, "readReview")
      .mockImplementation((directory, name) =>
        name === B
          ? Promise.reject(new Error("unreadable join metadata"))
          : actual(directory, name),
      );
    try {
      run.attach(run.token);
      await run.edit("B.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      expect(run.namedFrames).toEqual([]);
      run.negatives();
    } finally {
      read.mockRestore();
      await run.close();
    }
  });

  it("orders held join initialization before a left-refollow scope move and its first edits", async () => {
    const run = await fixture();
    const actual = storage.readReview;
    const started = barrier();
    const release = barrier();
    let held = false;
    const read = vi.spyOn(storage, "readReview").mockImplementation(async (directory, name) => {
      const review = await actual(directory, name);
      if (name === B && !held) {
        held = true;
        started.resolve();
        await release.promise;
      }
      return review;
    });
    try {
      const detach = run.attach(run.token);
      await started.promise;
      detach();
      await setScope(run.config.dataDir, B, [{ repo: REPO, paths: ["C.ts"] }], [REPO]);
      run.attach();
      release.resolve();
      await run.edit("B.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      await run.edit("C.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
        { type: "diff-changed", repo: REPO, files: ["C.ts"], session: B },
      ]);
      run.negatives();
    } finally {
      release.resolve();
      read.mockRestore();
      await run.close();
    }
  });

  it("recovers routing on a fresh reconnect after an unreadable join without a data burst", async () => {
    const run = await fixture();
    const actual = storage.readReview;
    const read = vi
      .spyOn(storage, "readReview")
      .mockImplementation((directory, name) =>
        name === B
          ? Promise.reject(new Error("unreadable join metadata"))
          : actual(directory, name),
      );
    try {
      const detach = run.attach(run.token);
      await run.edit("C.ts", 2);
      expect(run.namedFrames).toEqual([]);
      detach();
      read.mockRestore();
      run.attach();
      await run.edit("B.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
        { type: "diff-changed", repo: REPO, files: ["B.ts"], session: B },
      ]);
      run.negatives();
      await run.lockBurst();
      expect(
        run.events.filter((event) => event.type === "session-changed" && event.name === B),
      ).toHaveLength(1);
    } finally {
      read.mockRestore();
      await run.close();
    }
  });

  it("drops a join read completed after left before a later unserved subscription", async () => {
    const run = await fixture();
    const actual = storage.readReview;
    const started = barrier();
    const release = barrier();
    let held = false;
    const read = vi.spyOn(storage, "readReview").mockImplementation(async (directory, name) => {
      const review = await actual(directory, name);
      if (name === B && !held) {
        held = true;
        started.resolve();
        await release.promise;
      }
      return review;
    });
    try {
      const detach = run.attach(run.token);
      await started.promise;
      detach();
      await setScope(run.config.dataDir, B, [{ repo: REPO, paths: ["C.ts"] }], [REPO]);
      release.resolve();
      await run.edit("B.ts", 2);
      run.attach();
      await run.edit("C.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
        { type: "diff-changed", repo: REPO, files: ["C.ts"], session: B },
      ]);
      run.negatives();
      await run.lockBurst();
      expect(run.events.filter((event) => event.type === "session-changed")).toEqual([]);
    } finally {
      release.resolve();
      read.mockRestore();
      await run.close();
    }
  });
});
