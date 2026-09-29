/** One directory tree: the recursive `fs.watch` where the runtime has it, a walk on a timer where
 * not (05-watcher.md, "What it watches…"). Paths are relative, with forward slashes. */
import type { Dirent, FSWatcher } from "node:fs";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Whether a path is a directory to walk into or a file to report. */
export type PathKind = "dir" | "file";

/** `true` leaves the path out: a directory is not entered, a file is not reported. */
export type Ignore = (path: string, kind: PathKind) => boolean;

export type TreeWatcherOptions = {
  /** Absolute path of the directory to watch. */
  dir: string;
  ignore: Ignore;
  /** Called with the path of every change that is not ignored. */
  onChange: (path: string) => void;
  /** How often the fallback walks the tree. */
  pollIntervalMs?: number;
  /** `false` walks the tree from the start; the default tries the recursive watch. */
  recursive?: boolean;
  /** The walk replaced a watch and has its baseline; the tree is the caller's to read whole. */
  onFallback?: () => void;
  /** The native watch. A test that has to fail one after it started brings its own. */
  native?: (options: TreeWatcherOptions, onFailure: () => void) => TreeSource | null;
};

export type TreeWatcher = {
  /** `true` when the tree is walked on a timer instead of watched. */
  polling: () => boolean;
  /** Resolves once the tree is watched for real: a change before the walk's baseline is part of
   * it, so a caller about to say "the server is up" waits (05-watcher.md, "Starting it"). */
  ready: Promise<void>;
  close: () => void;
};

const DEFAULT_POLL_INTERVAL_MS = 250;

/** How long the runtime probe waits for the event that proves the watch recurses. */
const PROBE_TIMEOUT_MS = 500;

/** How often the probe writes while it waits. */
const PROBE_WRITE_MS = 50;

/** One way of watching a tree, before `watchTree` puts the two behind one face. */
export type TreeSource = { polling: boolean; ready: Promise<void>; close: () => void };

/** Neither the watch nor the timer keeps the process alive: the server's socket decides that
 * (05-watcher.md, "Starting it"). */
export function watchTree(options: TreeWatcherOptions): TreeWatcher {
  let current: TreeSource | null = null;
  let closed = false;

  /** A watch that fails after it started leaves the tree unwatched; the walk takes over. */
  function fallBack(): void {
    if (closed || current?.polling === true) return;
    current?.close();
    const replacement = polling(options);
    current = replacement;
    // The replacement's baseline is silent, so the takeover itself is the
    // signal: what changed inside that window is read whole, not name by name.
    void replacement.ready
      .then(() => {
        if (!closed) options.onFallback?.();
      })
      .catch(() => undefined);
  }

  if (options.recursive !== false) current = (options.native ?? native)(options, fallBack);
  current ??= polling(options);

  return {
    polling: () => current?.polling ?? true,
    // The live one: a caller that waits after a takeover is waiting for the
    // walk that replaced the watch, not for the watch that died.
    get ready(): Promise<void> {
      return current?.ready ?? Promise.resolve();
    },
    close: () => {
      closed = true;
      current?.close();
    },
  };
}

function native(options: TreeWatcherOptions, onFailure: () => void): TreeSource | null {
  // inotify does not recurse, and Node 22 emulates it per inode, losing a file replaced by rename
  // after the first time (05-watcher.md, "One watch per directory on Linux").
  if (process.platform === "linux") return perDirectory(options, onFailure);
  try {
    const watcher = watch(
      options.dir,
      { recursive: true, persistent: false, encoding: "utf8" },
      (_event, filename) => {
        if (filename === null) return;
        const path = String(filename).split("\\").join("/");
        if (path === "" || options.ignore(path, "file")) return;
        options.onChange(path);
      },
    );
    // An error from inotify or FSEvents arrives as an event, and an unhandled
    // one ends the process: the watch is dropped and the walk takes its place.
    watcher.on("error", () => {
      watcher.close();
      onFailure();
    });
    // A platform without recursive watch refuses at `watch` — Node raises
    // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM — and the walk takes over.
    return { polling: false, ready: Promise.resolve(), close: () => watcher.close() };
  } catch {
    return null;
  }
}

/** A directory this tree does not watch and is not failed by: gone between being named and being
 * watched, or not the server's to read, which the walk skips too (05-watcher.md). */
function skipped(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM";
}

/** A directory's inode with its birth and change times, or `null` when it is gone. */
type Identity = { ino: bigint; birth: bigint; change: bigint };

async function identity(path: string): Promise<Identity | null> {
  try {
    const info = await stat(path, { bigint: true });
    return { ino: info.ino, birth: info.birthtimeNs, change: info.ctimeNs };
  } catch {
    return null;
  }
}

/** One non-recursive watch per directory the ignore rules let in, taken by the tree itself: a
 * directory's inode outlives every rename into it (05-watcher.md, "One watch per directory…"). */
function perDirectory(options: TreeWatcherOptions, onFailure: () => void): TreeSource | null {
  const watches = new Map<string, FSWatcher>();
  // Which directory each watch is on: one removed and made again under its name is another.
  const identities = new Map<string, Identity>();
  // Birth times count once one differs from its change time: without statx libuv reports the
  // change time in its place, which moves with every entry (05-watcher.md).
  let births = false;
  // Per directory: the listing not yet started, which every request made meanwhile shares, and the
  // last one chained, which the next waits for.
  const queued = new Map<string, Promise<void>>();
  const chained = new Map<string, Promise<void>>();
  // Every listing and arm started so far, chained once each: an event waits for the ones before it.
  const tracked = new WeakSet<Promise<void>>();
  let barrier: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let closed = false;

  const close = (): void => {
    closed = true;
    for (const watcher of watches.values()) watcher.close();
    watches.clear();
  };

  const fail = (): void => {
    if (closed) return;
    close();
    onFailure();
  };

  const within = (relative: string, name: string): string =>
    relative === "" ? name : `${relative}/${name}`;

  const learn = (id: Identity): void => {
    if (id.birth !== 0n && id.birth !== id.change) births = true;
  };

  const same = (a: Identity, b: Identity): boolean =>
    a.ino === b.ino && (!births || a.birth === b.birth);

  const track = (work: Promise<void>): void => {
    if (tracked.has(work)) return;
    tracked.add(work);
    pending += 1;
    const held = work
      .catch(() => fail())
      .finally(() => {
        pending -= 1;
      });
    barrier = Promise.all([barrier, held]);
  };

  /** A name waits for the work under way when its event came, so the tree reports in the order of
   * the writes, a new directory's files included (05-watcher.md, "What the unit tests hold"). */
  const report = (path: string): void => {
    if (pending === 0) {
      options.onChange(path);
      return;
    }
    void barrier.then(() => {
      if (!closed) options.onChange(path);
    });
  };

  /** Drops the watches of a directory that is gone, and of everything that was under it. */
  const forget = (relative: string): void => {
    for (const [path, watcher] of watches) {
      if (path === relative || path.startsWith(`${relative}/`)) {
        watcher.close();
        watches.delete(path);
        identities.delete(path);
      }
    }
  };

  /** Whether this call took the watch, found one already held, or skips the directory; any other
   * refusal — `ENOSPC`, `EMFILE` — throws. */
  const take = (relative: string): "taken" | "held" | "skipped" => {
    if (closed || watches.has(relative)) return "held";
    let watcher: FSWatcher;
    try {
      watcher = watch(
        join(options.dir, relative),
        { persistent: false, encoding: "utf8" },
        (event, name) => onEvent(relative, event, name),
      );
    } catch (error) {
      if (skipped(error)) return "skipped";
      throw error;
    }
    watches.set(relative, watcher);
    // A directory removed under its watch is not a dead watch; anything else is, and the walk
    // takes the tree.
    watcher.on("error", () => {
      void stat(join(options.dir, relative)).then(
        () => fail(),
        () => forget(relative),
      );
    });
    return "taken";
  };

  /** Watches a directory and every one below it; one found after the start reports its files,
   * since they may have been written before its watch existed. */
  async function arm(relative: string, fresh: boolean): Promise<void> {
    // Read before the watch is taken: a replacement in between is then seen as one later.
    const id = await identity(join(options.dir, relative));
    if (id === null || closed) return;
    const taken = take(relative);
    if (taken === "skipped") return;
    learn(id);
    // Only the call that took the watch says what it is on; another arm read a later directory.
    if (taken === "taken") identities.set(relative, id);
    let entries: Dirent[];
    try {
      entries = await readdir(join(options.dir, relative), { withFileTypes: true });
    } catch {
      forget(relative);
      return;
    }
    const below: Promise<void>[] = [];
    for (const entry of entries) {
      if (closed) break;
      const path = within(relative, entry.name);
      if (entry.isDirectory()) {
        if (!watches.has(path) && !options.ignore(path, "dir")) below.push(arm(path, fresh));
      } else if (fresh && entry.isFile() && !options.ignore(path, "file")) {
        options.onChange(path);
      }
    }
    await Promise.all(below);
  }

  /** A watched directory that is gone, or another under its name, is watched again from scratch. */
  async function recheck(path: string): Promise<void> {
    const id = await identity(join(options.dir, path));
    const known = identities.get(path);
    if (closed || !watches.has(path) || known === undefined) return;
    if (id !== null) {
      learn(id);
      if (same(id, known)) return;
    }
    forget(path);
    if (id !== null) await arm(path, true);
  }

  /** Finds the directories that came, went or were replaced: by listing and by identity rather
   * than by the event's name, which Bun drops when several changes share one read (05-watcher.md). */
  async function listOnce(relative: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(join(options.dir, relative), { withFileTypes: true });
    } catch {
      forget(relative);
      return;
    }
    const present = new Set<string>();
    const checks: Promise<void>[] = [];
    for (const entry of entries) {
      if (closed) break;
      if (!entry.isDirectory()) continue;
      const path = within(relative, entry.name);
      present.add(path);
      if (options.ignore(path, "dir")) continue;
      checks.push(watches.has(path) ? recheck(path) : arm(path, true));
    }
    await Promise.all(checks);
    for (const path of [...watches.keys()]) {
      const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
      if (path !== relative && parent === relative && !present.has(path)) forget(path);
    }
  }

  /** One listing after the one under way, shared by every request until it starts: a request
   * waits for two listings at most, however fast the events come. */
  function relist(relative: string): Promise<void> {
    const waiting = queued.get(relative);
    if (waiting !== undefined) return waiting;
    const listing = (chained.get(relative) ?? Promise.resolve()).then(() => {
      queued.delete(relative);
      return closed ? undefined : listOnce(relative);
    });
    queued.set(relative, listing);
    chained.set(relative, listing);
    void listing
      .finally(() => {
        if (chained.get(relative) === listing) chained.delete(relative);
      })
      .catch(() => undefined);
    return listing;
  }

  function onEvent(relative: string, event: string, name: string | null): void {
    if (closed) return;
    if (name !== null && name !== "") {
      const path = within(relative, String(name));
      if (!options.ignore(path, "file")) report(path);
      // A rename naming a watched directory made or removed that name: its watch is renewed
      // whatever the identity says, which a filesystem without a birth time cannot tell.
      if (event === "rename" && watches.has(path)) {
        forget(path);
        track(arm(path, true));
      }
    }
    track(relist(relative));
  }

  try {
    // The root is taken now, so a runtime that refuses it walks from the start.
    if (!take("")) return null;
  } catch {
    return null;
  }
  const ready = arm("", false).catch(() => fail());
  track(ready);
  return { polling: false, ready, close };
}

function polling(options: TreeWatcherOptions): TreeSource {
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let previous = new Map<string, string>();
  let closed = false;
  let running = false;

  const tick = async (report: boolean): Promise<void> => {
    if (running || closed) return;
    running = true;
    try {
      const next = await snapshot(options.dir, options.ignore);
      if (report) {
        for (const [path, stamp] of next) {
          if (previous.get(path) !== stamp) options.onChange(path);
        }
        for (const path of previous.keys()) {
          if (!next.has(path)) options.onChange(path);
        }
      }
      previous = next;
    } finally {
      running = false;
    }
  };

  // The first walk is the baseline: what is already on disk is not a change.
  const ready = tick(false);
  const timer = setInterval(() => void tick(true), interval);
  timer.unref?.();
  return {
    polling: true,
    ready,
    close: () => {
      closed = true;
      clearInterval(timer);
    },
  };
}

/** Every file of the tree with the stamp a change moves: modification time and size. */
async function snapshot(dir: string, ignore: Ignore): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const pending: string[] = [""];
  while (pending.length > 0) {
    const relative = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(join(dir, relative), { withFileTypes: true });
    } catch {
      // A directory removed between the listing of its parent and this read is
      // not an error: the next walk will not have it either.
      continue;
    }
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!ignore(path, "dir")) pending.push(path);
        continue;
      }
      // Symbolic links are not followed, the way the scanner does not follow
      // them: a link out of the tree is not part of it.
      if (!entry.isFile() || ignore(path, "file")) continue;
      try {
        const info = await stat(join(dir, path));
        files.set(path, `${info.mtimeMs}:${info.size}`);
      } catch {
        // Gone between the listing and the stat; the walk that sees it missing
        // reports it as a change.
      }
    }
  }
  return files;
}

/** Whether this runtime's `fs.watch` really recurses, answered by a probe that writes inside the
 * data directory only (05-watcher.md, "What it watches…"). */
export async function supportsRecursiveWatch(dir: string): Promise<boolean> {
  // The answer is the runtime's, not the directory's, so it is asked once and
  // every watcher after the first gets it without writing anything.
  probed ??= probeRecursiveWatch(dir);
  return probed;
}

/** The answer of this process, once it has one. */
let probed: Promise<boolean> | null = null;

/** How the probe writes. A test that has to make the write fail brings its own. */
type ProbeWrite = (path: string, data: string) => Promise<void>;

/** The probe itself, past the memo of `supportsRecursiveWatch`: answers, never throws. */
export async function probeRecursiveWatch(
  dir: string,
  write: ProbeWrite = writeFile,
): Promise<boolean> {
  let probe: string | null = null;
  try {
    await mkdir(dir, { recursive: true });
    probe = await mkdtemp(join(dir, ".watch-probe-"));
    const nested = join(probe, "nested");
    await mkdir(nested);
    const watched = probe;
    return await new Promise<boolean>((resolve) => {
      let source: TreeSource | null = null;
      const done = (answer: boolean): void => {
        clearTimeout(timer);
        clearInterval(writing);
        source?.close();
        resolve(answer);
      };
      // Not unref'd: it alone holds the event loop while the probe waits, or the process would exit
      // before its server listened (05-watcher.md).
      const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
      // Written again and again: a watch that arms a moment after `watch` returns, as Bun's does,
      // misses a single write and would answer "cannot recurse" for the whole run.
      const writing = setInterval(() => {
        void write(join(nested, "deep"), `probe ${Date.now()}`).catch(() => undefined);
      }, PROBE_WRITE_MS);
      // The watch the trees take, so the answer is about the one that will run.
      const onChange = (name: string): void => {
        if (name.includes("deep")) done(true);
      };
      source = native({ dir: watched, ignore: () => false, onChange }, () => done(false));
      if (source === null) {
        done(false);
        return;
      }
      // A filesystem already refusing writes answers now rather than after the
      // timeout, and the probe still returns a boolean instead of throwing.
      void write(join(nested, "deep"), "probe").catch(() => done(false));
    });
  } catch {
    return false;
  } finally {
    if (probe !== null) await rm(probe, { recursive: true, force: true }).catch(() => undefined);
  }
}
