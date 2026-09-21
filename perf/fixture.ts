/**
 * What the gate is allowed to erase. `--fixture` names a directory `perf/gate.ts`
 * owns, and the gate empties it before regenerating — so the question the
 * generator asks its `--out` has to be asked here too, by whoever erases
 * (DA-63). `scripts/synth.ts` keeps its own guard: it is spawned with the path
 * the gate already cleared, and a generator that trusts its caller has none.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This file is `<repository>/perf/fixture.ts`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Paths that are never a fixture whatever they hold: the repository, everything
 * above it up to the filesystem root, and the home directory.
 */
function neverAFixture(): Set<string> {
  const paths = new Set<string>([homedir()]);
  for (let at = REPO_ROOT; ; at = dirname(at)) {
    paths.add(at);
    if (dirname(at) === at) return paths;
  }
}

/**
 * Refuses a `--fixture` the gate must not erase, before anything is erased.
 * Missing is fine — the gate makes it; existing is fine only when it is an
 * empty directory or one holding a `.diffalanche/` from an earlier run.
 */
export function assertErasable(fixture: string): void {
  const path = resolve(fixture);
  if (neverAFixture().has(path)) {
    throw new Error(
      `${path} is the repository, an ancestor of it, or the home directory; ` +
        "--fixture names a directory the gate owns and erases",
    );
  }
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) {
    throw new Error(`${path} is not a directory`);
  }
  const entries = readdirSync(path);
  if (entries.length === 0 || entries.includes(".diffalanche")) return;
  throw new Error(`${path} is not empty and holds no .diffalanche/ from an earlier run`);
}
