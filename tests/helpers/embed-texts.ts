/** Embeds the texts of `EMBED_TEXTS` with the cached model and prints the vectors as JSON:
 * the other runtime's half of the Node/Bun comparison in `tests/embed.test.ts`. */
import { stdout } from "node:process";
import { defaultCacheHome, modelDirectory } from "../../src/core/ml/embed/cache.ts";
import { embedder } from "../../src/core/ml/embed/embedder.ts";
import { EMBEDDING_MODEL } from "../../src/core/ml/embed/model.ts";

const texts = JSON.parse(process.env.EMBED_TEXTS ?? "[]") as string[];
const loaded = await embedder(modelDirectory(defaultCacheHome(), EMBEDDING_MODEL));
const vectors = await loaded.embed(texts);
stdout.write(JSON.stringify(vectors.map((vector) => Array.from(vector))));
