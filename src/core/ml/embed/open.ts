/** The doors to the embedder for a command or a route: the platform and the files are checked
 * before the runtime is imported, so nothing else pays for `onnxruntime-node`. */
import { modelStatus } from "./cache.ts";
import type { Embedder } from "./embedder.ts";
import { ModelError } from "./errors.ts";
import { currentPlatform, EMBEDDING_MODEL, EMBEDDING_PLATFORMS } from "./model.ts";
import { startThreadedEmbedder, type ThreadedEmbedder } from "./threaded.ts";

async function assertAvailable(location: string): Promise<void> {
  const platform = currentPlatform();
  if (!EMBEDDING_PLATFORMS.includes(platform)) {
    throw new ModelError(
      `the embedding model does not run on ${platform}: its runtime has no build for it (ADR-014)`,
    );
  }
  const status = await modelStatus(location, EMBEDDING_MODEL);
  if (!status.present) {
    const missing = status.files.filter((file) => !file.present).map((file) => file.name);
    throw new ModelError(
      `the embedding model is not in ${location}: ${missing.join(", ")} missing or incomplete`,
    );
  }
}

/** On the calling thread: for a command, which has nothing else to serve. */
export async function openEmbedder(location: string): Promise<Embedder> {
  await assertAvailable(location);
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

/** On a thread of its own: for the server, whose event loop a run must not hold. */
export async function openThreadedEmbedder(location: string): Promise<ThreadedEmbedder> {
  await assertAvailable(location);
  return startThreadedEmbedder(location);
}
