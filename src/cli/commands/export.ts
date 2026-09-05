/**
 * `export`: the review as markdown grouped by repository, the text the UI's
 * `raw` tab shows (`docs/SPEC.md` section 8, `docs/design/HANDOFF.md` section 9).
 */
import { exportMarkdown, list, readSession } from "../../core/domain/index.ts";
import { choice, noExtra } from "../args.ts";
import type { Command } from "../command.ts";
import { json } from "../output.ts";

const STATUSES = ["open", "all"] as const;
const FORMATS = ["md", "json"] as const;

export const exportReview: Command = {
  spec: {
    name: "export",
    about: "the review as markdown grouped by repository",
    options: {
      status: { type: "string", value: "<open|all>", about: "which comments; default: open" },
      format: { type: "string", value: "<md|json>", about: "default: md" },
    },
  },
  run: async (context, args) => {
    noExtra(args, 0);
    const status = choice(args, "status", STATUSES) ?? "open";
    const session = await context.session();
    const { dataDir } = await context.config();
    const review = await readSession(dataDir, session);
    const comments = await list(dataDir, session, { status });
    if ((choice(args, "format", FORMATS) ?? "md") === "json") {
      json(context.io, { review, comments });
    } else {
      context.io.out(exportMarkdown(review, comments));
    }
    return 0;
  },
};
