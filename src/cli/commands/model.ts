/** `model status` and `model pull --embedding`: which embedding model this build is pinned to,
 * where it is cached, and putting it there. Neither reads a configuration or a session. */
import type { FileStatus } from "../../core/ml/embed/cache.ts";
import {
  defaultCacheHome,
  modelDirectory,
  modelStatus as readStatus,
  runtimeStatus,
} from "../../core/ml/embed/cache.ts";
import { assets, delivery, provide, releaseBase } from "../../core/ml/embed/delivery.ts";
import { currentPlatform, EMBEDDING_MODEL, EMBEDDING_RUNTIME } from "../../core/ml/embed/model.ts";
import { prepare } from "../../core/ml/embed/open.ts";
import { flag, noExtra } from "../args.ts";
import type { Command } from "../command.ts";
import { UsageError } from "../errors.ts";
import { json, table } from "../output.ts";
import { VERSION } from "../version.ts";

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function state(files: FileStatus[]): string {
  const missing = files.filter((file) => !file.present).map((file) => file.name);
  const total = files.reduce((sum, file) => sum + file.expected, 0);
  return missing.length === 0
    ? `present, ${megabytes(total)}`
    : `absent: ${missing.join(", ")} missing or incomplete`;
}

/** The runtime beside the model: `node_modules`' own from the sources, the cache's on the two
 * channels, and none on a platform it has no build for (ADR-014, 3B). */
async function runtime(location: string) {
  const platform = currentPlatform();
  const status = await runtimeStatus(location, platform);
  if (status === null) return { name: EMBEDDING_RUNTIME, platform, available: false } as const;
  if (delivery().from === "sources") {
    return { name: EMBEDDING_RUNTIME, platform, available: true, from: "node_modules" } as const;
  }
  return { ...status, available: true, from: "cache" } as const;
}

export const modelStatus: Command = {
  spec: {
    name: "model status",
    about: "the embedding model: its version, where it is cached, and whether it is there",
    options: { json: { type: "boolean", about: "print the status with every file" } },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
    const status = await readStatus(location, EMBEDDING_MODEL);
    const native = await runtime(location);
    if (flag(args, "json")) {
      json(context.io, { embedding: status, runtime: native });
      return 0;
    }
    const where = !native.available
      ? "not available on this platform"
      : native.from === "node_modules"
        ? "from node_modules"
        : state(native.files);
    context.io.out(
      `${table([
        ["embedding", `${status.name} ${status.quantization} @ ${status.revision.slice(0, 12)}`],
        ["source", status.source],
        ["location", status.location],
        ["state", state(status.files)],
        ["runtime", `${native.name}, ${native.platform}: ${where}`],
      ])}\n`,
    );
    return 0;
  },
};

export const modelPull: Command = {
  spec: {
    name: "model pull",
    about: "put a model into the user cache now rather than on first use",
    options: {
      embedding: { type: "boolean", about: "the embedding model, and the runtime it needs" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    if (!flag(args, "embedding")) {
      throw new UsageError("model pull needs --embedding: the generative model comes in Phase 4");
    }
    const location = modelDirectory(defaultCacheHome(), EMBEDDING_MODEL);
    const progress = (text: string) => context.io.err(text);
    // From the sources the runtime is the package's own: only the model is fetched, and from
    // the release, the same files the npm channel downloads.
    if (delivery().from === "sources") {
      const release = { from: "release", base: releaseBase(VERSION) } as const;
      await provide(assets(EMBEDDING_MODEL, null), location, release, progress);
    } else {
      await prepare(location, progress);
    }
    context.io.out(
      `${EMBEDDING_MODEL.name} @ ${EMBEDDING_MODEL.revision.slice(0, 12)} in ${location}\n`,
    );
    return 0;
  },
};
