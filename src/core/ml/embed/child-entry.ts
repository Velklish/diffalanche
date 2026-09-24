/** The model's process from the sources and the npm package: `spawned.ts` starts this file, and
 * `scripts/bundle.ts` builds it as `dist/embed-child.js`. */
import { serveChild } from "./child.ts";

serveChild();
