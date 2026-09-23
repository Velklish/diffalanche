/** The one door to the embedder for a command or a route: the platform and the files are
 * checked before the runtime is imported, so nothing else pays for `onnxruntime-node`. */

import { modelStatus } from "./cache.ts";
import type { Embedder } from "./embedder.ts";
import { ModelError } from "./errors.ts";
import { currentPlatform, EMBEDDING_MODEL, EMBEDDING_PLATFORMS } from "./model.ts";

export async function openEmbedder(location: string): Promise<Embedder> {
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
