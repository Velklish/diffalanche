/** Where the npm channel keeps the embedding model: a user-level cache shared by every root,
 * named after the model and its revision so that two pinned versions never share a directory. */
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { EmbeddingModel } from "./model.ts";

/** `$XDG_CACHE_HOME`, or `~/.cache` when the variable is unset or empty. */
export function defaultCacheHome(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? xdg : resolve(homedir(), ".cache");
}

/** `<cacheHome>/diffalanche/models/<name>-<first 12 of the revision>`. */
export function modelDirectory(cacheHome: string, model: EmbeddingModel): string {
  return join(cacheHome, "diffalanche", "models", `${model.name}-${model.revision.slice(0, 12)}`);
}

type FileStatus = { name: string; bytes: number; expected: number; present: boolean };

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

/** What is on disk for the model, without reading the weights: `model status` answers in a
 * stat per file, and a checksum of 118 MB is the download's job, not the status line's. */
export async function modelStatus(location: string, model: EmbeddingModel): Promise<ModelStatus> {
  const files = await Promise.all(
    model.files.map(async (file): Promise<FileStatus> => {
      const bytes = await stat(join(location, file.name)).then(
        (info) => (info.isFile() ? info.size : 0),
        () => 0,
      );
      return { name: file.name, bytes, expected: file.bytes, present: bytes === file.bytes };
    }),
  );
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
