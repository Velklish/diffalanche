/** The doors to the embedder for a command or a route: the platform is checked and the files are
 * put in place before the runtime is imported, so nothing else pays for `onnxruntime-node`. */
import { join } from "node:path";
import { modelStatus, runtimeDirectory } from "./cache.ts";
import { assets, delivery, missingFrom, provide } from "./delivery.ts";
import type { Embedder } from "./embedder.ts";
import { ModelError } from "./errors.ts";
import { currentPlatform, EMBEDDING_MODEL, EMBEDDING_PLATFORMS } from "./model.ts";
import { startThreadedEmbedder, type ThreadedEmbedder } from "./threaded.ts";

/** Where a patched build's `onnxruntime-node` loads its binding from (scripts/build.ts). */
declare global {
  var __diffalancheOrtBinding: string | undefined;
}

/** Nothing on stderr: a caller that wants the download's progress passes its own. */
const quiet = () => {};

const preparing = new Map<string, Promise<string | undefined>>();
/** A preparation the server started and nobody has been told the end of yet. */
const failed = new Map<string, unknown>();

/** The model's files in `location` and, on the two channels, the runtime's in its own directory
 * there; the binding to load (`undefined`: node_modules). One per directory at a time. */
export function prepare(
  location: string,
  progress: (text: string) => void = quiet,
): Promise<string | undefined> {
  let pending = preparing.get(location);
  if (pending === undefined) {
    pending = put(location, progress).finally(() => preparing.delete(location));
    preparing.set(location, pending);
  }
  return pending;
}

async function put(
  location: string,
  progress: (text: string) => void,
): Promise<string | undefined> {
  const platform = currentPlatform();
  if (!EMBEDDING_PLATFORMS.includes(platform)) {
    throw new ModelError(
      `the embedding model does not run on ${platform}: its runtime has no build for it (ADR-014)`,
    );
  }
  const from = delivery();
  if (from.from !== "sources") {
    await provide(assets(EMBEDDING_MODEL, platform), location, from, progress);
    return join(runtimeDirectory(location, platform), "onnxruntime_binding.node");
  }
  const status = await modelStatus(location, EMBEDDING_MODEL);
  if (!status.present) {
    const missing = status.files.filter((file) => !file.present).map((file) => file.name);
    throw new ModelError(
      `the embedding model is not in ${location}: ${missing.join(", ")} missing or incomplete; ` +
        "`bun run model:fetch` puts it there",
    );
  }
  return undefined;
}

/** On the calling thread: for a command, which has nothing else to serve. */
export async function openEmbedder(
  location: string,
  progress?: (text: string) => void,
): Promise<Embedder> {
  globalThis.__diffalancheOrtBinding = await prepare(location, progress);
  let module: typeof import("./embedder.ts");
  try {
    module = await import("./embedder.ts");
  } catch (error) {
    throw new ModelError(
      `the embedding runtime could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return module.embedder(location);
}

/** Whether a preparation would only look: nothing to download or write out. */
async function inPlace(location: string): Promise<boolean> {
  const platform = currentPlatform();
  if (delivery().from === "sources" || !EMBEDDING_PLATFORMS.includes(platform)) return true;
  return (await missingFrom(assets(EMBEDDING_MODEL, platform), location)).length === 0;
}

/** On a thread of its own, for the server: a request does not wait for 180 MB, it is refused while
 * the files arrive in the background and then told how that ended (09-ml.md, "Delivery"). */
export async function openThreadedEmbedder(
  location: string,
  progress?: (text: string) => void,
): Promise<ThreadedEmbedder> {
  const failure = failed.get(location);
  if (failure !== undefined) {
    failed.delete(location);
    throw failure;
  }
  if (!(await inPlace(location))) {
    prepare(location, progress).catch((error: unknown) => failed.set(location, error));
    throw new ModelError(
      `the embedding model is being put in place in ${location}: suggestions follow once it is there`,
    );
  }
  return startThreadedEmbedder(location, { binding: await prepare(location, progress) });
}
