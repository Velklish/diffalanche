/** `GET /api/suggest`: one worker thread for the model, started by the first request, and the
 * requests one at a time ([07-server.md](../../docs/reference/07-server.md#suggestions)). */
import { stat } from "node:fs/promises";
import { defaultCacheHome, modelDirectory } from "../core/ml/embed/cache.ts";
import type { Embedder } from "../core/ml/embed/embedder.ts";
import { EMBEDDING_MODEL } from "../core/ml/embed/model.ts";
import { openThreadedEmbedder } from "../core/ml/embed/open.ts";
import type { EmbeddingIndex } from "../core/ml/index/index.ts";
import { indexPath } from "../core/ml/index/index.ts";
import type { Suggestions } from "../core/ml/suggest/index.ts";
import { suggest } from "../core/ml/suggest/index.ts";

export type SuggestService = {
  suggest: (body: string) => Promise<Pick<Suggestions, "severity" | "suggestions">>;
  /** Ends the thread, if one was started. */
  close: () => Promise<void>;
};

type Opened = Embedder & { close?: () => Promise<void>; exited?: Promise<void> };

/** Size and time of `index.bin`: whether the index held in memory is still the one on disk. */
async function stamp(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null);
  return info === null ? null : `${info.size}:${info.mtimeMs}`;
}

/** `open` is the worker thread of the user cache's model; a test hands its own. */
export function createSuggestService(
  dataDir: string,
  open: () => Promise<Opened> = () =>
    openThreadedEmbedder(modelDirectory(defaultCacheHome(), EMBEDDING_MODEL), (text) =>
      process.stderr.write(text),
    ),
): SuggestService {
  let started: Promise<Opened> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  // Read once and kept: at 10 000 comments a read of index.bin is most of a warm request.
  let held: { index: EmbeddingIndex; stamp: string | null } | null = null;
  return {
    suggest(body) {
      if (started === null) {
        const starting = open();
        // A model that was absent, or a thread that has ended, is started again on the next request.
        const forget = () => {
          if (started === starting) started = null;
        };
        starting.then((opened) => opened.exited?.then(forget), forget);
        started = starting;
      }
      const embedder = started;
      const next = queue.then(async () => {
        const path = indexPath(dataDir);
        const current =
          held !== null && held.stamp === (await stamp(path)) ? held.index : undefined;
        const answer = await suggest(dataDir, await embedder, body, current);
        held = { index: answer.index, stamp: await stamp(path) };
        return { severity: answer.severity, suggestions: answer.suggestions };
      });
      queue = next.catch(() => undefined);
      return next;
    },
    close: async () => {
      const embedder = await started?.catch(() => null);
      await embedder?.close?.();
    },
  };
}
