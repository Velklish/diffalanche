/** `index rebuild` and `index status`: the embedding index over every session's comments
 * ([09-ml.md](../../../docs/reference/09-ml.md#the-index)). */
import { defaultCacheHome, modelDirectory } from "../../core/ml/embed/cache.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "../../core/ml/embed/model.ts";
import { openEmbedder } from "../../core/ml/embed/open.ts";
import type { IndexStatus } from "../../core/ml/index/index.ts";
import {
  describeIdentity,
  indexStatus,
  sameIdentity,
  updateIndex,
} from "../../core/ml/index/index.ts";
import { listSessionNames } from "../../core/storage/index.ts";
import { flag, noExtra } from "../args.ts";
import type { Command } from "../command.ts";
import { UsageError } from "../errors.ts";
import { json, table } from "../output.ts";

/** Refuses before anything is loaded or written, like `list`: a root that has never been reviewed
 * gets no `.diffalanche` from a command that only reads history. */
export async function assertHistory(dataDir: string, what: string): Promise<void> {
  if ((await listSessionNames(dataDir)).names.length === 0) {
    throw new UsageError(`no review session in ${dataDir}: ${what}`);
  }
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

export const indexRebuild: Command = {
  spec: {
    name: "index rebuild",
    about: "embed every comment of every review session again and write the index",
    options: {},
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const { dataDir } = await context.config();
    await assertHistory(dataDir, "there is nothing to index");
    const started = performance.now();
    const embedder = await openEmbedder(
      modelDirectory(defaultCacheHome(), EMBEDDING_MODEL),
      (text) => context.io.err(text),
    );
    const { update } = await updateIndex(dataDir, embedder, { rebuild: true });
    for (const warning of update.warnings) context.io.err(`diffalanche: ${warning}\n`);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    context.io.out(
      `indexed ${plural(update.embedded, "comment")} of ${plural(update.sessions, "review session")} in ${seconds} s\n`,
    );
    return 0;
  },
};

export const indexStatusCommand: Command = {
  spec: {
    name: "index status",
    about: "what the embedding index holds, and what it is missing",
    options: { json: { type: "boolean", about: "print the status as JSON" } },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const { dataDir } = await context.config();
    const status = await indexStatus(dataDir, embeddingIdentity());
    if (flag(args, "json")) {
      json(context.io, { index: status });
      return 0;
    }
    for (const warning of status.warnings) context.io.err(`diffalanche: ${warning}\n`);
    const rows = [["index", status.location]];
    if (status.builtBy !== null) {
      rows.push(["built by", describeIdentity(status.builtBy)]);
      rows.push([
        "holds",
        `${plural(status.comments, "comment")} of ${plural(status.sessions, "review session")}, updated ${status.updatedAt}`,
      ]);
    }
    rows.push(["state", state(status)]);
    context.io.out(`${table(rows)}\n`);
    return 0;
  },
};

function state(status: IndexStatus): string {
  if (status.problem !== null) return `unreadable, rebuilt by the next update: ${status.problem}`;
  if (status.builtBy === null) return "absent: `diffalanche index rebuild` builds it";
  if (!sameIdentity(status.builtBy, status.build)) {
    return `built by another model or runtime; the next update embeds every comment again with ${describeIdentity(status.build)}`;
  }
  if (status.missing === 0 && status.gone === 0) return "current";
  const gone = `${status.gone} ${status.gone === 1 ? "entry" : "entries"}`;
  return `${plural(status.missing, "comment")} to embed, ${gone} to drop`;
}
