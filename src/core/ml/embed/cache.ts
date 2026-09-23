/** Where the npm channel keeps the embedding model: a user-level cache shared by every root,
 * named after the model and its revision so that two pinned versions never share a directory. */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { EmbeddingModel, ModelFile } from "./model.ts";
import { EMBEDDING_NATIVE, EMBEDDING_RUNTIME } from "./model.ts";

/** `$XDG_CACHE_HOME`, or `~/.cache` when the variable is unset or empty. */
export function defaultCacheHome(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? xdg : resolve(homedir(), ".cache");
}

/** `<cacheHome>/diffalanche/models/<name>-<first 12 of the revision>`. */
export function modelDirectory(cacheHome: string, model: EmbeddingModel): string {
  return join(cacheHome, "diffalanche", "models", `${model.name}-${model.revision.slice(0, 12)}`);
}

/** The runtime's native files keep a directory of their version and platform inside the model's:
 * two versions of the tool with two runtimes never write each other's (09-ml.md, "Delivery"). */
export function runtimeDirectoryName(platform: string): string {
  return `${EMBEDDING_RUNTIME.replace(" ", "-")}-${platform}`;
}

export function runtimeDirectory(location: string, platform: string): string {
  return join(location, runtimeDirectoryName(platform));
}

export type FileStatus = { name: string; bytes: number; expected: number; present: boolean };

type ModelStatus = {
  name: string;
  source: string;
  revision: string;
  quantization: string;
  location: string;
  /** Every file there with the size the manifest names; a size is the check a status can afford. */
  present: boolean;
  files: FileStatus[];
};

async function filesStatus(location: string, files: ModelFile[]): Promise<FileStatus[]> {
  return Promise.all(
    files.map(async (file): Promise<FileStatus> => {
      const bytes = await stat(join(location, file.name)).then(
        (info) => (info.isFile() ? info.size : 0),
        () => 0,
      );
      return { name: file.name, bytes, expected: file.bytes, present: bytes === file.bytes };
    }),
  );
}

/** What is on disk for the model, without reading the weights: `model status` answers in a
 * stat per file, and a checksum of 118 MB is the download's job, not the status line's. */
export async function modelStatus(location: string, model: EmbeddingModel): Promise<ModelStatus> {
  const files = await filesStatus(location, model.files);
  return {
    name: model.name,
    source: model.source,
    revision: model.revision,
    quantization: model.quantization,
    location,
    present: files.every((file) => file.present),
    files,
  };
}

type RuntimeStatus = {
  name: string;
  platform: string;
  location: string;
  present: boolean;
  files: FileStatus[];
};

/** The runtime's native files as the two channels keep them; `null` on a platform the runtime
 * has no build for (ADR-014, 3B). */
export async function runtimeStatus(
  location: string,
  platform: string,
): Promise<RuntimeStatus | null> {
  const native = EMBEDDING_NATIVE[platform];
  if (native === undefined) return null;
  const directory = runtimeDirectory(location, platform);
  const files = await filesStatus(directory, native);
  return {
    name: EMBEDDING_RUNTIME,
    platform,
    location: directory,
    present: files.every((file) => file.present),
    files,
  };
}
