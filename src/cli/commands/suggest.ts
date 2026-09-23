/** `suggest`: similar past comments from every review session and a likely severity
 * (`docs/SPEC.md` section 8, [09-ml.md](../../../docs/reference/09-ml.md#suggestions)). */
import { defaultCacheHome, modelDirectory } from "../../core/ml/embed/cache.ts";
import { EMBEDDING_MODEL } from "../../core/ml/embed/model.ts";
import { openEmbedder } from "../../core/ml/embed/open.ts";
import type { Neighbour } from "../../core/ml/index/index.ts";
import { suggest as suggestFor } from "../../core/ml/suggest/index.ts";
import { flag, noExtra, required } from "../args.ts";
import type { Command } from "../command.ts";
import { firstLine } from "../comments.ts";
import { UsageError } from "../errors.ts";
import { json, table } from "../output.ts";
import { assertHistory } from "./embedding-index.ts";

/** Where a suggestion was written: the session, then the anchor as `list` prints it. */
function source(one: Neighbour): string {
  if (one.repo === null) return `${one.session}  the review`;
  if (one.path === null) return `${one.session}  ${one.repo}`;
  return `${one.session}  ${one.repo}/${one.path}${one.line === null ? "" : `:${one.line}`}`;
}

export const suggest: Command = {
  spec: {
    name: "suggest",
    about: "similar past comments from every review session, and a likely severity",
    options: {
      body: { type: "string", value: "<text>", about: "the comment being written" },
      json: { type: "boolean", about: "print the severity and the comments with their sources" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const body = required(args, "body");
    // The same refusal as the route's: a blank text has no neighbours worth a model load.
    if (body.trim() === "") throw new UsageError("--body is blank");
    const { dataDir } = await context.config();
    await assertHistory(dataDir, "there is no history to suggest from");
    const embedder = await openEmbedder(modelDirectory(defaultCacheHome(), EMBEDDING_MODEL));
    const { suggestions, severity, update } = await suggestFor(dataDir, embedder, body);
    for (const warning of update.warnings) context.io.err(`diffalanche: ${warning}\n`);
    if (flag(args, "json")) {
      json(context.io, { severity, suggestions });
      return 0;
    }
    if (suggestions.length === 0) {
      context.io.out("no comments in any review session yet\n");
      return 0;
    }
    const proposal =
      severity === null
        ? "none: nothing written before is near enough"
        : `${severity.severity}, confidence ${severity.confidence.toFixed(2)}`;
    const rows = suggestions.map((one) => [
      one.similarity.toFixed(2),
      one.severity,
      source(one),
      firstLine(one.body),
    ]);
    context.io.out(`severity  ${proposal}\n\n${table(rows)}\n`);
    return 0;
  },
};
