/** How the model and the runtime's native files reach the user cache: downloaded from the
 * release by the npm channel, written out of the binary by the binary (09-ml.md, "Delivery"). */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { runtimeDirectoryName } from "./cache.ts";
import { ModelError } from "./errors.ts";
import type { EmbeddingModel, ModelFile } from "./model.ts";
import { EMBEDDING_NATIVE } from "./model.ts";

/**
 * `sources`: the runtime of `node_modules`, and the model `bun run model:fetch` puts in the
 * cache. `release`: the npm channel, which downloads both from `base`. `binary`: the files the
 * binary carries, by asset name.
 */
type Delivery =
  | { from: "sources" }
  | { from: "release"; base: string }
  | { from: "binary"; files: Readonly<Record<string, string>> };

let chosen: Delivery = { from: "sources" };

/** Called once by a channel's entry point, before any command runs. */
export function deliverFrom(delivery: Delivery): void {
  chosen = delivery;
}

export function delivery(): Delivery {
  return chosen;
}

/** The release of `version`; `DIFFALANCHE_ASSETS_URL` names a mirror of it instead. */
export function releaseBase(version: string, env: NodeJS.ProcessEnv = process.env): string {
  const mirror = env.DIFFALANCHE_ASSETS_URL;
  return mirror ? mirror : `https://github.com/Velklish/diffalanche/releases/download/v${version}`;
}

/** A file of the release, named so that every pin and every platform has its own, and the
 * directory under the model's it goes to: `""` for the model, the runtime's own for its files. */
export type Asset = { asset: string; file: ModelFile; within: string };

/** The model's files and a platform's native files, as the release names them; `null` for the
 * model alone. */
export function assets(model: EmbeddingModel, platform: string | null): Asset[] {
  const within = platform === null ? "" : runtimeDirectoryName(platform);
  return [
    ...model.files.map((file) => ({
      asset: `${model.name}-${model.revision.slice(0, 12)}-${file.name}`,
      file,
      within: "",
    })),
    ...(platform === null ? [] : (EMBEDDING_NATIVE[platform] ?? [])).map((file) => ({
      asset: `${within}-${file.name}`,
      file,
      within,
    })),
  ];
}

async function sizeOf(path: string): Promise<number | null> {
  return stat(path).then(
    (info) => (info.isFile() ? info.size : null),
    () => null,
  );
}

/** The files of `wanted` that are not in `directory` with their size: a file only takes its name
 * once its checksum held, so a size is the check a start can afford. */
export async function missingFrom(wanted: Asset[], directory: string): Promise<Asset[]> {
  const sizes = await Promise.all(
    wanted.map((one) => sizeOf(join(directory, one.within, one.file.name))),
  );
  return wanted.filter((one, at) => sizes[at] !== one.file.bytes);
}

async function sha256Of(path: string): Promise<string | null> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  } catch {
    return null;
  }
  return hash.digest("hex");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

/** This machine in a partial file's name: a process id means nothing to another host that shares
 * the cache, a container or a machine with the same home on NFS. */
const HOST = hostname().replace(/[^A-Za-z0-9.-]/g, "_") || "host";

/** A partial file of another host nobody has written to for this long is abandoned. */
const ABANDONED_MS = 10 * 60 * 1000;

/** The partial files of `name` that no process is writing: a command killed halfway leaves its
 * own, and a download is never resumed, so nothing else would ever take them away. */
async function sweep(place: string, name: string): Promise<void> {
  const entries = await readdir(place).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.startsWith(`${name}.partial-`)) continue;
    const left = /^(.+)-(\d+)-[0-9a-f]+$/.exec(entry.slice(name.length + ".partial-".length));
    if (left === null) continue;
    const path = join(place, entry);
    const ended =
      left[1] === HOST
        ? !alive(Number(left[2]))
        : await stat(path).then(
            (info) => Date.now() - info.mtimeMs > ABANDONED_MS,
            () => false,
          );
    if (ended) await rm(path, { force: true });
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A write to the cache that failed: its own line, since a network would not help. */
class WriteError extends Error {}

async function writing<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw new WriteError(reason(error));
  }
}

/** Writes `source` to `partial` and hashes it. Read whole: a file a binary carries is in Bun's own
 * filesystem, which `readFile` reaches and `copyFile` and a read stream do not (09-ml.md). */
async function copyOut(source: string, partial: string): Promise<string> {
  const bytes = await readFile(source);
  await writing(() => writeFile(partial, bytes, { flag: "wx" }));
  return createHash("sha256").update(bytes).digest("hex");
}

function size(bytes: number): string {
  return bytes < 100_000
    ? `${Math.max(1, Math.round(bytes / 1000))} kB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Streams `url` into `partial`, hashing as it goes; a quarter at a time on `progress`. */
async function download(
  url: string,
  partial: string,
  bytes: number,
  progress: (text: string) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(cause?.code ?? cause?.message ?? String(error));
  }
  if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
  const hash = createHash("sha256");
  const handle = await writing(() => open(partial, "wx"));
  let received = 0;
  let shown = 0;
  // A reader rather than `for await`: Bun 1.3.14's async iterator of a fetch body failed 9–14 of 40
  // downloads with "undefined is not a function" (09-ml.md, "Delivery").
  const reader = response.body.getReader();
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const chunk = read.value;
      hash.update(chunk);
      await writing(() => handle.write(chunk));
      received += chunk.length;
      const quarters = Math.min(4, Math.floor((received * 4) / bytes));
      for (; shown < quarters; shown += 1) progress(` ${(shown + 1) * 25}%`);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/** Set in the process that writes a binary's files out, so that it writes them itself. */
const APART = "DIFFALANCHE_WRITE_OUT";

/** The binary's files written out by a process of their own, `model pull --embedding`: reading
 * them touches 180 MB of the executable, and the process that loads the model after it would
 * carry that on top (09-ml.md, "Delivery"). */
async function writeOutApart(progress: (text: string) => void): Promise<void> {
  const child = spawn(process.execPath, ["model", "pull", "--embedding"], {
    env: { ...process.env, [APART]: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let said = "";
  child.stderr.on("data", (chunk: Buffer) => {
    said += chunk.toString();
  });
  const code = await new Promise<number | null>((done, fail) => {
    child.on("close", done);
    child.on("error", fail);
  }).catch((error: unknown) => {
    throw new ModelError(`the model could not be written out of the binary: ${reason(error)}`);
  });
  progress(said);
  if (code !== 0) {
    throw new ModelError(
      `the model could not be written out of the binary: ${said.trim() || `exit code ${code}`}`,
    );
  }
}

/** Gives `partial` its name, then reads back what the name holds. A rename that fails because
 * another process got there first is its win, and its file is held to the pin the same way. */
async function settle(partial: string, target: string, file: ModelFile): Promise<void> {
  let failed: unknown = null;
  await rename(partial, target).catch(async (error: unknown) => {
    failed = error;
    await rm(partial, { force: true });
  });
  const held = await sha256Of(target);
  if (held === file.sha256) return;
  if (failed !== null) {
    throw new ModelError(`${target} could not take its name: ${reason(failed)}`);
  }
  await rm(target, { force: true });
  throw new ModelError(
    `${target} held sha256 ${held} once written, and this build pins ${file.sha256}: it was ` +
      "removed, and the next run fetches it again",
  );
}

/** Puts each file of `wanted` not under `directory` with its size in place, held to the pin before
 * it takes its name and read back after: a file of the right name is whole and right (09-ml.md). */
export async function provide(
  wanted: Asset[],
  directory: string,
  from: Exclude<Delivery, { from: "sources" }>,
  progress: (text: string) => void,
): Promise<void> {
  const missing = await missingFrom(wanted, directory);
  if (from.from === "binary" && missing.length > 0 && process.env[APART] !== "1") {
    await writeOutApart(progress);
  }
  for (const { asset, file, within } of wanted) {
    const place = join(directory, within);
    const target = join(place, file.name);
    if ((await sizeOf(target)) === file.bytes) continue;
    const source = from.from === "release" ? `${from.base}/${asset}` : from.files[asset];
    if (source === undefined) {
      throw new ModelError(`this binary does not carry ${asset}, which ${place} needs`);
    }
    // This process's own: two that prepare one directory at once never write one file.
    const partial = `${target}.partial-${HOST}-${process.pid}-${randomBytes(4).toString("hex")}`;
    await sweep(place, file.name);
    let got: string;
    try {
      await writing(() => mkdir(place, { recursive: true }));
      if (from.from === "release") {
        progress(`downloading ${asset}, ${size(file.bytes)}:`);
        got = await download(source, partial, file.bytes, progress);
        progress("\n");
      } else {
        got = await copyOut(source, partial);
      }
    } catch (error) {
      await rm(partial, { force: true });
      if (from.from === "release") progress("\n");
      if (error instanceof WriteError) {
        throw new ModelError(
          `${file.name} could not be written to ${place}: ${error.message}. Nothing was left ` +
            "behind; with room on the disk and the right to write there, " +
            "`diffalanche model pull --embedding` puts it in place",
        );
      }
      if (from.from === "binary") throw error;
      throw new ModelError(
        `${file.name} is not in ${place} and could not be downloaded from ${source}: ` +
          `${reason(error)}. Nothing was written; ` +
          "`diffalanche model pull --embedding` fetches it once there is a network",
      );
    }
    if (got !== file.sha256) {
      await rm(partial, { force: true });
      throw new ModelError(
        `${source} has sha256 ${got}, and this build pins ${file.sha256}: nothing was written`,
      );
    }
    await settle(partial, target, file);
  }
}
