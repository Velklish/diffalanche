/** `model status`: which embedding model this build is pinned to and where it is cached.
 * It reads no configuration and no session, like `version`. */
import {
  defaultCacheHome,
  modelDirectory,
  modelStatus as readStatus,
} from "../../core/ml/embed/cache.ts";
import { EMBEDDING_MODEL } from "../../core/ml/embed/model.ts";
import { flag, noExtra } from "../args.ts";
import type { Command } from "../command.ts";
import { json, table } from "../output.ts";

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
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
    if (flag(args, "json")) {
      json(context.io, { embedding: status });
      return 0;
    }
    const missing = status.files.filter((file) => !file.present).map((file) => file.name);
    const total = status.files.reduce((sum, file) => sum + file.expected, 0);
    const state = status.present
      ? `present, ${megabytes(total)}`
      : `absent: ${missing.join(", ")} missing or incomplete`;
    context.io.out(
      `${table([
        ["embedding", `${status.name} ${status.quantization} @ ${status.revision.slice(0, 12)}`],
        ["source", status.source],
        ["location", status.location],
        ["state", state],
      ])}\n`,
    );
    return 0;
  },
};
