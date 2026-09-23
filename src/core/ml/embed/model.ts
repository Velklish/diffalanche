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

/** The runtime's native files per platform, where they sit in the `onnxruntime-node` package:
 * the binding and the libraries it loads from its own directory. darwin-x64 has none (ADR-014). */
export const EMBEDDING_NATIVE: Readonly<Record<string, ModelFile[]>> = {
  "darwin-arm64": [
    {
      name: "onnxruntime_binding.node",
      path: "bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
      bytes: 266_840,
      sha256: "a3f993357759b06ae2411f70af60f5e041d04521ea7f0d12cb7546e411a527dd",
    },
    {
      name: "libonnxruntime.1.dylib",
      path: "bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib",
      bytes: 44_589_928,
      sha256: "685d2be5dba1309c89d3a5324b7fd06a5c42f1a61bfea32d14c4cc28d072121d",
    },
  ],
  "linux-x64": [
    {
      name: "onnxruntime_binding.node",
      path: "bin/napi-v6/linux/x64/onnxruntime_binding.node",
      bytes: 389_488,
      sha256: "ccdc60b981d93a490cf9513d3f583547252b6e285b72988a96a494f2f006c7b8",
    },
    {
      name: "libonnxruntime.so.1",
      path: "bin/napi-v6/linux/x64/libonnxruntime.so.1",
      bytes: 45_828_512,
      sha256: "ffb75a925ba05e47b235bb66e3e3911714a80b328a9c9425539feb204aa32a23",
    },
  ],
  "linux-arm64": [
    {
      name: "onnxruntime_binding.node",
      path: "bin/napi-v6/linux/arm64/onnxruntime_binding.node",
      bytes: 394_648,
      sha256: "afec78dc11d38dc81605b068cefe1fc73ffe77ca240c15468aa40786150beac8",
    },
    {
      name: "libonnxruntime.so.1",
      path: "bin/napi-v6/linux/arm64/libonnxruntime.so.1",
      bytes: 25_135_496,
      sha256: "1f549d46250b005580b597f4164984aaf75b3bcb9f3aeb07c7f8a8fe60b23c76",
    },
  ],
  "win32-x64": [
    {
      name: "onnxruntime_binding.node",
      path: "bin/napi-v6/win32/x64/onnxruntime_binding.node",
      bytes: 298_848,
      sha256: "ddd428464069b84414d34ec1796c7c2a69c33a976e4b0390692629e394f92fa1",
    },
    {
      name: "onnxruntime.dll",
      path: "bin/napi-v6/win32/x64/onnxruntime.dll",
      bytes: 28_754_232,
      sha256: "508c362f5673483dd3a086379c392795b2e42d10d5e6f3f90ebd7ac21c97af67",
    },
    {
      name: "DirectML.dll",
      path: "bin/napi-v6/win32/x64/DirectML.dll",
      bytes: 18_527_584,
      sha256: "234e8898778cdec88d3cb0539508273494082812c968699f3de665a018971625",
    },
    {
      name: "dxcompiler.dll",
      path: "bin/napi-v6/win32/x64/dxcompiler.dll",
      bytes: 17_986_360,
      sha256: "593d42df78c7f9cbd97c1374af107cfe20985759f98b77afc1448fe41ee3cc76",
    },
    {
      name: "dxil.dll",
      path: "bin/napi-v6/win32/x64/dxil.dll",
      bytes: 1_508_664,
      sha256: "cf9a3981263f8ec30c9905d136eeaf4b4573209c602198671b958ec86905dea8",
    },
  ],
  "win32-arm64": [
    {
      name: "onnxruntime_binding.node",
      path: "bin/napi-v6/win32/arm64/onnxruntime_binding.node",
      bytes: 422_200,
      sha256: "d8179924f15c2d3c1c8a75c50adf1671ec28c7f1cb0da9fc28b17daa02c5ecf5",
    },
    {
      name: "onnxruntime.dll",
      path: "bin/napi-v6/win32/arm64/onnxruntime.dll",
      bytes: 29_815_136,
      sha256: "6c3a2abf5c6aca11c48a0d338a91af309f2266f25ce2e4084e6a87bbcb0fbfd0",
    },
    {
      name: "DirectML.dll",
      path: "bin/napi-v6/win32/arm64/DirectML.dll",
      bytes: 18_444_600,
      sha256: "aaf72a9d55aa123e0708d957d30dd4fbeb7a2e335ec6257ed5ff4261a402b9ee",
    },
    {
      name: "dxcompiler.dll",
      path: "bin/napi-v6/win32/arm64/dxcompiler.dll",
      bytes: 22_285_624,
      sha256: "442a995492579e1048cf1f05a86ab00f476c46b7f9d0996e588884040a543bbe",
    },
    {
      name: "dxil.dll",
      path: "bin/napi-v6/win32/arm64/dxil.dll",
      bytes: 1_769_784,
      sha256: "859b6d638c5ca3df39e9cab2a602cb0f63d0e63d750f84bb2a9ec9031319b73e",
    },
  ],
};

/** The platforms the runtime ships native files for. */
export const EMBEDDING_PLATFORMS: readonly string[] = Object.keys(EMBEDDING_NATIVE);

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
