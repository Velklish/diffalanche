/** DA-56.12: a held document's first subscription needs scope before any later data burst. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFailed, onTestFinished, vi } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession, setScope, useSession as activateSession } from "../src/core/domain/index.ts";
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

async function bounded<T>(pending: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`test barrier ${label} timed out`)), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function holdRescanAndJoin() {
  const rescan = { entered: barrier(), release: barrier(), held: false };
  const join = { entered: barrier(), release: barrier(), held: false, armed: false };
  const actual = storage.readReview;
  const read = vi.spyOn(storage, "readReview").mockImplementation(async (directory, name) => {
    const review = await actual(directory, name);
    const hold = name === A ? rescan : name === B && join.armed ? join : null;
    if (hold !== null && !hold.held) {
      hold.held = true;
      hold.entered.resolve();
      await bounded(hold.release.promise, name === A ? "rescan release" : "join release");
    }
    return review;
  });
  const restore = () => {
    rescan.release.resolve();
    join.release.resolve();
    read.mockRestore();
  };
  onTestFinished(restore);
  return {
    rescan,
    join,
    restore,
    armJoin: () => {
      join.armed = true;
    },
  };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-followed-scope-"));
  onTestFailed(() => {
    process.stderr.write(`followed-scope fixture: ${root}\n`);
  });
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
  const close = async () => {
    stream.close();
    await watcher?.close();
    rmSync(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  };
  onTestFinished(close);
  return {
    config,
    service,
    current: () => watcher?.session(),
    token,
    events,
    currentFrames,
    rescans,
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
    close,
  };
}

describe("a newly followed held scope", () => {
  it("releases an in-flight notice without routing it to an unknown joined task", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      run.attach(undefined, "unknown-task");
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await run.edit("C.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      expect(run.namedFrames).toEqual([]);
      run.negatives();
    } finally {
      held.restore();
      await run.close();
    }
  });

  it("releases an in-flight notice without routing through unreadable joined metadata", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    const path = join(run.config.dataDir, "reviews", B, "review.json");
    const before = readFileSync(path);
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      run.attach(run.token);
      await bounded(run.onopenRead(), "post-open payload");
      writeFileSync(path, "{");
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await run.edit("C.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      expect(run.namedFrames).toEqual([]);
      run.negatives();
    } finally {
      writeFileSync(path, before);
      expect(readFileSync(path)).toEqual(before);
      held.restore();
      await run.close();
    }
  });

  for (const mode of ["no token", "expired token"] as const) {
    it(`delivers an in-flight notice after a ${mode} join without a data burst`, async () => {
      const run = await fixture();
      const held = holdRescanAndJoin();
      held.join.release.resolve();
      try {
        const edited = run.edit("B.ts", 2);
        await bounded(held.rescan.entered.promise, "rescan entered");
        const clock =
          mode === "expired token"
            ? vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001)
            : null;
        run.attach(mode === "no token" ? undefined : run.token);
        clock?.mockRestore();
        await bounded(run.onopenRead(), "post-open payload");
        held.armJoin();
      held.rescan.release.resolve();
        await bounded(edited, "repository drain");
        await vi.waitFor(
          () =>
            expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
              { type: "diff-changed", repo: REPO, files: ["B.ts"], session: B },
            ]),
          { timeout: 100 },
        );
        run.negatives();
      } finally {
        held.restore();
        vi.restoreAllMocks();
        await run.close();
      }
    });
  }

  it("uses actual C scope for a stale B token joined during an in-flight B rescan", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    held.join.release.resolve();
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      await setScope(run.config.dataDir, B, [{ repo: REPO, paths: ["C.ts"] }], [REPO]);
      run.attach(run.token);
      held.armJoin();
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await run.edit("C.ts", 2);
      await vi.waitFor(
        () =>
          expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
            { type: "diff-changed", repo: REPO, files: ["C.ts"], session: B },
          ]),
        { timeout: 100 },
      );
      run.negatives();
    } finally {
      held.restore();
      await run.close();
    }
  });

  it("requeues a captured B notice behind a later left-refollow C initializer", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      const detach = run.attach(run.token);
      await bounded(run.onopenRead(), "post-open payload");
      held.armJoin();
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await bounded(held.join.entered.promise, "join entered");
      detach();
      await setScope(run.config.dataDir, B, [{ repo: REPO, paths: ["C.ts"] }], [REPO]);
      run.attach();
      held.join.release.resolve();
      await run.edit("C.ts", 2);
      await vi.waitFor(
        () =>
          expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
            { type: "diff-changed", repo: REPO, files: ["C.ts"], session: B },
          ]),
        { timeout: 100 },
      );
      run.negatives();
    } finally {
      held.restore();
      await run.close();
    }
  });

  it("drops a captured notice when its named task leaves before join initialization finishes", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      const detach = run.attach(run.token);
      held.armJoin();
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await bounded(held.join.entered.promise, "join entered");
      detach();
      held.join.release.resolve();
      await run.edit("C.ts", 2);
      expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([]);
      expect(run.namedFrames).toEqual([]);
      run.negatives();
    } finally {
      held.restore();
      await run.close();
    }
  });

  it("does not send a captured notice to a different task that joins only after capture", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      run.attach(run.token);
      held.armJoin();
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await bounded(held.join.entered.promise, "join entered");
      await createSession(run.config.dataDir, "late-task", { mode: "head" }, undefined, {
        scope: [{ repo: REPO, paths: ["B.ts"] }],
        use: false,
      });
      run.attach(undefined, "late-task");
      held.join.release.resolve();
      await vi.waitFor(
        () =>
          expect(run.events.filter((event) => event.type === "diff-changed")).toEqual([
            { type: "diff-changed", repo: REPO, files: ["B.ts"], session: B },
          ]),
        { timeout: 100 },
      );
      run.negatives();
    } finally {
      held.restore();
      await run.close();
    }
  });

  it("rechecks current after a captured notice waits behind joins and a pointer move", async () => {
    const run = await fixture();
    const held = holdRescanAndJoin();
    try {
      const edited = run.edit("B.ts", 2);
      await bounded(held.rescan.entered.promise, "rescan entered");
      run.attach(run.token);
      held.armJoin();
      held.rescan.release.resolve();
      await bounded(edited, "repository drain");
      await bounded(held.join.entered.promise, "join entered");
      await activateSession(run.config.dataDir, B);
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const moved = run.lockBurst();
      // Enqueue the configured data debounce before the next join and the notice's release.
      vi.advanceTimersByTime(1);
      vi.useRealTimers();
      run.attach();
      held.join.release.resolve();
      await bounded(moved, "current data drain");
      expect(run.current()).toBe(B);
      await run.edit("C.ts", 2);
      expect(run.events).toContainEqual({ type: "current-changed", name: B });
      expect(
        run.events.filter((event) => event.type === "diff-changed" && event.session === B),
      ).toEqual([]);
      expect(run.rescans).not.toContain(A);
    } finally {
      held.restore();
      await run.close();
    }
  });

  it("notifies B joined during an already running rescan after its held post-open read", async () => {
    const run = await fixture();
    const actual = storage.readReview;
    const entered = barrier();
    const release = barrier();
    let held = false;
    const read = vi.spyOn(storage, "readReview").mockImplementation(async (directory, name) => {
      const review = await actual(directory, name);
      if (name === A && !held) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return review;
    });
    try {
      const edited = run.edit("B.ts", 2);
      await entered.promise;
      run.attach(run.token);
      await run.onopenRead();
      release.resolve();
      await edited;
      await vi.waitFor(
        () =>
          expect(
            run.events.filter((event) => event.type === "diff-changed" && event.session === B),
          ).toHaveLength(1),
        { timeout: 100 },
      );
      run.negatives();
      await run.edit("B.ts", 3);
      await vi.waitFor(
        () =>
          expect(
            run.events.filter((event) => event.type === "diff-changed" && event.session === B),
          ).toHaveLength(2),
        { timeout: 100 },
      );
      run.negatives();
    } finally {
      release.resolve();
      read.mockRestore();
      await run.close();
    }
  });

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
