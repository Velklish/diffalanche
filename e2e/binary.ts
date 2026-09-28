/** The binary of this platform (`--target current`) and the fixture it serves: server and CLI are
 * that one file, since section 10 is about the shipped artefact, not the sources. */
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";

/** The repository root: every command the suite runs is run from there. */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The target name `scripts/build.ts` spells, and `scripts/smoke.sh` after it. */
const TARGET = `${platform === "win32" ? "windows" : platform}-${arch}`;

export const BINARY = `./dist/diffalanche-${TARGET}${platform === "win32" ? ".exe" : ""}`;

/** Its own directory: `test:ui` and the performance gate keep the fixtures they had. */
export const FIXTURE = ".perf/acceptance";

/** The session `scripts/synth.ts` makes current. */
export const SESSION = "synth";
