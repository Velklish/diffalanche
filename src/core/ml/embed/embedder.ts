/** Texts in, unit vectors out: the tokenizer and the ONNX session, loaded once per process.
 * onnxruntime-node is an N-API addon and loads unchanged on Bun, so nothing here asks which. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";
import { modelStatus } from "./cache.ts";
import { EMBEDDING_MODEL, type EmbeddingModel } from "./model.ts";

export type Embedder = {
  model: EmbeddingModel;
  /** One L2-normalised vector per text, in the order the texts were given. */
  embed: (texts: string[]) => Promise<Float32Array[]>;
};

/** The ids of one text, cut to the model's window with `</s>` kept at the end. */
export function truncate(ids: number[], maxTokens: number): number[] {
  if (ids.length <= maxTokens) return ids;
  return [...ids.slice(0, maxTokens - 1), ids[ids.length - 1] as number];
}

/** The mean of a text's hidden states, one row of `dimensions` per token, at unit length. */
export function meanPool(hidden: Float32Array, tokens: number, dimensions: number): Float32Array {
  const sum = new Float64Array(dimensions);
  for (let token = 0; token < tokens; token += 1) {
    for (let d = 0; d < dimensions; d += 1) {
      sum[d] = (sum[d] ?? 0) + (hidden[token * dimensions + d] ?? 0);
    }
  }
  const norm = Math.hypot(...sum);
  return Float32Array.from(sum, (value) => value / norm);
}

/** Reads the model from `location` and starts a session; `embedder` is the one-load door. */
export async function loadEmbedder(
  location: string,
  model: EmbeddingModel = EMBEDDING_MODEL,
): Promise<Embedder> {
  const status = await modelStatus(location, model);
  if (!status.present) {
    const missing = status.files.filter((file) => !file.present).map((file) => file.name);
    throw new Error(`the embedding model is not in ${location}: ${missing.join(", ")} missing`);
  }
  const [tokenizerJson, tokenizerConfig] = await Promise.all(
    ["tokenizer.json", "tokenizer_config.json"].map(async (name) =>
      JSON.parse(await readFile(join(location, name), "utf8")),
    ),
  );
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const session = await ort.InferenceSession.create(join(location, "model_quantized.onnx"), {
    graphOptimizationLevel: "all",
    // Spinning pool threads cost about three times the CPU of the work on a busy machine and
    // changed no vector (ADR-014); the server shares its cores with everything else it does.
    extra: { session: { intra_op: { allow_spinning: "0" } } },
  });
  const typeIds = session.inputNames.includes("token_type_ids");

  async function one(text: string): Promise<Float32Array> {
    const ids = truncate(tokenizer.encode(model.prefix + text).ids, model.maxTokens);
    const shape = [1, ids.length];
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
    };
    if (typeIds) {
      feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(ids.length), shape);
    }
    const output = (await session.run(feeds)).last_hidden_state;
    if (output === undefined) throw new Error("the embedding model has no last_hidden_state");
    return meanPool(output.data as Float32Array, ids.length, model.dimensions);
  }

  return {
    model,
    embed: async (texts) => {
      // One text per run: int8 activations are scaled per tensor, so in a batch a text's
      // vector would depend on its neighbours (ADR-014 measures by how much).
      const vectors: Float32Array[] = [];
      for (const text of texts) vectors.push(await one(text));
      return vectors;
    },
  };
}

const loaded = new Map<string, Promise<Embedder>>();

/** The embedder for `location`, loaded on the first call and shared by every later one; a load
 * that failed is forgotten, so the call after the model arrives loads it. */
export function embedder(location: string): Promise<Embedder> {
  let pending = loaded.get(location);
  if (pending === undefined) {
    pending = loadEmbedder(location);
    loaded.set(location, pending);
    pending.catch(() => loaded.delete(location));
  }
  return pending;
}
