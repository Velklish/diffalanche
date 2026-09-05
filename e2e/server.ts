/**
 * The server the UI tests run against: the built page over the small synthetic
 * review. The shell tests stub `GET /api/review` with an empty review, so both
 * the empty shell and a real diff are covered by one server.
 */
import { buildReviewBundle, createApp, directoryAssets, startServer } from "../src/server/index.ts";

const fixture = process.env.FIXTURE ?? ".perf/e2e";
const port = Number(process.env.PORT ?? "4881");
const bundle = await buildReviewBundle(fixture);
const server = await startServer(createApp({ bundle, ui: directoryAssets("dist/ui") }), port);
process.stderr.write(`ui tests on http://127.0.0.1:${server.port} over ${fixture}\n`);
