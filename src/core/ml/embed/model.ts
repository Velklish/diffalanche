/** The embedding model the tool is pinned to: which files, from which commit, with which
 * checksums. Why this model and this runtime is ADR-014; what reads it is 09-ml.md. */

/** `path` is where the file sits in the pinned repository; `name` is what it is cached as. */
export type ModelFile = { name: string; path: string; bytes: number; sha256: string };

export type EmbeddingModel = {
  /** What `model status` calls it; the cache directory is named after it and the revision. */
  name: string;
  /** The Hugging Face repository the ONNX export lives in, and the commit it is pinned to. */
  source: string;
  revision: string;
  quantization: "int8";
  dimensions: number;
  /** What the model was trained to see in front of a text; e5 wants `query: ` on both sides. */
  prefix: string;
  /** The longest input the position table covers, `<s>` and `</s>` included. */
  maxTokens: number;
  files: ModelFile[];
};

export const EMBEDDING_MODEL: EmbeddingModel = {
  name: "multilingual-e5-small",
  source: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  quantization: "int8",
  dimensions: 384,
  prefix: "query: ",
  maxTokens: 512,
  files: [
    {
      name: "model_quantized.onnx",
      path: "onnx/model_quantized.onnx",
      bytes: 118_308_185,
      sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
    },
    {
      name: "tokenizer.json",
      path: "tokenizer.json",
      bytes: 17_082_730,
      sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    },
    {
      name: "tokenizer_config.json",
      path: "tokenizer_config.json",
      bytes: 443,
      sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    },
  ],
};

/** The runtime the vectors come from; `tests/embed.test.ts` holds it to the one installed. */
export const EMBEDDING_RUNTIME = "onnxruntime-node 1.30.0";

/** The platforms `onnxruntime-node` ships native files for; darwin-x64 has none (ADR-014). */
export const EMBEDDING_PLATFORMS: readonly string[] = [
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
];

/** What a vector belongs to: two vectors compare only when all four are the same (ADR-014). */
export type EmbeddingIdentity = {
  model: string;
  revision: string;
  runtime: string;
  platform: string;
};

export function currentPlatform(): string {
  return `${process.platform}-${process.arch}`;
}

export function embeddingIdentity(model: EmbeddingModel = EMBEDDING_MODEL): EmbeddingIdentity {
  return {
    model: model.name,
    revision: model.revision,
    runtime: EMBEDDING_RUNTIME,
    platform: currentPlatform(),
  };
}
