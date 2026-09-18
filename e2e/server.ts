/**
 * The server the UI tests run against: the built page over the small synthetic
 * review. The shell tests stub `GET /api/review` with an empty review, so both
 * the empty shell and a real diff are covered by one server.
 */
import { loadConfig } from "../src/core/config/index.ts";
import { directoryAssets, startReviewServer } from "../src/server/index.ts";

const fixture = process.env.FIXTURE ?? ".perf/e2e";
const port = Number(process.env.PORT ?? "4881");
const config = { ...(await loadConfig({ root: fixture })), port };
const server = await startReviewServer({ config, ui: directoryAssets("dist/ui") });
// The data directory too: a fixture served over someone else's holds no session,
// and every route about the review then answers 404 (DA-54.1).
process.stderr.write(`ui tests on ${server.url} over ${fixture}, data ${config.dataDir}\n`);
