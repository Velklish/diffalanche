#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverFrom, releaseBase } from "../core/ml/embed/delivery.ts";
import { directoryAssets } from "../server/assets.ts";
import { processOutput } from "./output.ts";
import { run } from "./run.ts";
import { VERSION } from "./version.ts";

/** The npm channel and every run from source: `dist/ui` beside the bundle, or two levels up
 * from source; the binary's entry embeds the UI (06-cli.md, "The two channels"). */
const here = fileURLToPath(new URL(".", import.meta.url));
const packaged = join(here, "ui");
const ui = directoryAssets(existsSync(packaged) ? packaged : join(here, "..", "..", "dist", "ui"));
// The npm package carries no model and no runtime: both come from this version's release, once.
if (existsSync(packaged)) deliverFrom({ from: "release", base: releaseBase(VERSION) });

const code = await run(process.argv.slice(2), ui, processOutput());
if (code !== 0) process.exit(code);
