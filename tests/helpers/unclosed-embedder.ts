/** A command that embeds a text through the model's process and ends without closing it: it prints
 * the process's id, and must exit on its own (tests/embedding-model.test.ts). */
import { defaultCacheHome, modelDirectory } from "../../src/core/ml/embed/cache.ts";
import { EMBEDDING_MODEL } from "../../src/core/ml/embed/model.ts";
import { openEmbedder } from "../../src/core/ml/embed/open.ts";

const embedder = await openEmbedder(modelDirectory(defaultCacheHome(), EMBEDDING_MODEL));
await embedder.embed(["Unused import."]);
process.stdout.write(`${embedder.pid}\n`);
