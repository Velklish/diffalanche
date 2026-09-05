/**
 * Watching one directory tree. `fs.watch` with `recursive: true` is the whole
 * implementation where the runtime has it; where it does not, the same
 * interface is served by walking the tree on a timer and comparing what
 * changed. Both report paths relative to the watched directory, with forward
 * slashes on every platform.
 */
import type { Dirent } from "node:fs";
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
};

export type TreeWatcher = {
  /** `true` when the tree is walked on a timer instead of watched. */
  polling: () => boolean;
  /**
   * Resolves once the tree is being watched for real. The walk of the fallback
   * takes its baseline first, and a change made before that baseline exists is
   * part of it rather than a change — so a caller that is about to say "the
   * server is up" waits for this.
   */
  ready: Promise<void>;
  close: () => void;
};

export const DEFAULT_POLL_INTERVAL_MS = 250;

/** How long the runtime probe waits for the event that proves the watch recurses. */
export const PROBE_TIMEOUT_MS = 500;

/** How often the probe writes while it waits. */
const PROBE_WRITE_MS = 50;

type Inner = { polling: boolean; ready: Promise<void>; close: () => void };

/**
 * Neither the recursive watch nor the timer keeps the process alive on its own:
 * a watcher is something a server owns, and the server's socket is what decides
 * how long the process runs. Without this a finished test would hang on a
 * watcher it forgot.
 */
export function watchTree(options: TreeWatcherOptions): TreeWatcher {
  let current: Inner | null = null;
  let closed = false;

  /** A watch that fails after it started leaves the tree unwatched; the walk takes over. */
  function fallBack(): void {
    if (closed || current?.polling === true) return;
    current?.close();
    current = polling(options);
  }

  if (options.recursive !== false) current = native(options, fallBack);
  current ??= polling(options);
  const ready = current.ready;

  return {
    polling: () => current?.polling ?? true,
    ready,
    close: () => {
      closed = true;
      current?.close();
    },
  };
}

function native(options: TreeWatcherOptions, onFailure: () => void): Inner | null {
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

function polling(options: TreeWatcherOptions): Inner {
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

/**
 * Whether this runtime's `fs.watch` really recurses. Accepting `recursive: true`
 * is not the same as honouring it — a runtime that accepts the option and
 * watches only the top directory would leave a silent dead watcher — so the
 * answer comes from a probe: a file written in a nested directory has to be
 * reported. The probe writes inside `dir`, which is the data directory; no
 * reviewed repository is touched.
 */
export async function supportsRecursiveWatch(dir: string): Promise<boolean> {
  // The answer is the runtime's, not the directory's, so it is asked once and
  // every watcher after the first gets it without writing anything.
  probed ??= probeRecursiveWatch(dir);
  return probed;
}

/** The answer of this process, once it has one. */
let probed: Promise<boolean> | null = null;

async function probeRecursiveWatch(dir: string): Promise<boolean> {
  let probe: string | null = null;
  try {
    await mkdir(dir, { recursive: true });
    probe = await mkdtemp(join(dir, ".watch-probe-"));
    const nested = join(probe, "nested");
    await mkdir(nested);
    return await new Promise<boolean>((resolve) => {
      let watcher: ReturnType<typeof watch>;
      const done = (answer: boolean): void => {
        clearTimeout(timer);
        clearInterval(writing);
        watcher.close();
        resolve(answer);
      };
      // Not unref'd: this timer is the only thing holding the event loop while
      // the probe waits, and a process that exits here would exit before the
      // server it is starting ever listened.
      const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
      // Written again and again rather than once: a watch that arms a moment
      // after `watch` returns — Bun's does — would miss a single write, and the
      // answer would be "this runtime cannot recurse" for the rest of the run.
      const writing = setInterval(() => {
        void writeFile(join(nested, "deep"), `probe ${Date.now()}`).catch(() => undefined);
      }, PROBE_WRITE_MS);
      try {
        watcher = watch(probe as string, { recursive: true, persistent: false }, (_e, name) => {
          if (name !== null && String(name).includes("deep")) done(true);
        });
      } catch {
        clearTimeout(timer);
        clearInterval(writing);
        resolve(false);
        return;
      }
      watcher.on("error", () => done(false));
      void writeFile(join(nested, "deep"), "probe");
    });
  } catch {
    return false;
  } finally {
    if (probe !== null) await rm(probe, { recursive: true, force: true }).catch(() => undefined);
  }
}
