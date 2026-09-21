/**
 * The two questions `perf/gate.ts` asks its `--fixture` before it measures it:
 * may this directory be erased (DA-63), and is what is in it still what the
 * generator wrote (DA-69).
 *
 * The erase guard is the one `scripts/synth.ts` has, moved to whoever deletes:
 * the gate empties the path before spawning the generator, so delegating the
 * question by spawning was delegating it to nobody. The generator keeps its own
 * copy, because it is also run by hand.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureStamp, Profile } from "../scripts/synth.ts";
import { PROFILES, STAMP_FILE } from "../scripts/synth.ts";

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

/**
 * Why the gate cannot measure this fixture, or `null` when it is what the
 * generator wrote (DA-69). `current` exists whatever it points at, and the
 * harness's own scratch session is what made it point elsewhere, so the check
 * is the stamp read back rather than one file's existence.
 */
export function fixtureDrift(fixture: string, profile: Profile = PROFILES.full): string | null {
  if (!existsSync(fixture)) return "is missing";
  const stamp = readJson(join(fixture, STAMP_FILE));
  if ("failed" in stamp) return `has no readable ${STAMP_FILE} (${stamp.failed})`;
  const wrote = stamp.value as FixtureStamp;
  if (!sameProfile(wrote.profile, profile)) {
    return `was generated at ${describe(wrote.profile)}, the gate measures ${describe(profile)}`;
  }

  const current = join(fixture, ".diffalanche", "current");
  if (!existsSync(current)) return "has no .diffalanche/current, so it has no review session";
  const names = readFileSync(current, "utf8").trim();
  if (names !== wrote.session) {
    return `points current at ${names}, the generator wrote ${wrote.session}`;
  }

  const path = join(fixture, ".diffalanche", "reviews", wrote.session, "comments.json");
  const held = readJson(path);
  if ("failed" in held) {
    return `has no readable ${wrote.session}/comments.json (${held.failed})`;
  }
  const comments = (held.value as { comments?: { replies?: unknown[] }[] }).comments ?? [];
  const replies = comments.reduce((sum, one) => sum + (one.replies?.length ?? 0), 0);
  if (comments.length !== wrote.threads || replies !== wrote.replies) {
    return (
      `holds ${comments.length} threads and ${replies} replies in ${wrote.session}, ` +
      `the generator wrote ${wrote.threads} and ${wrote.replies}`
    );
  }
  return null;
}

/** The parsed document, or the reason it could not be read. */
function readJson(path: string): { value: unknown } | { failed: string } {
  if (!existsSync(path)) return { failed: "missing" };
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) as unknown };
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}

function sameProfile(left: Profile | undefined, right: Profile): boolean {
  return (
    left !== undefined &&
    left.repos === right.repos &&
    left.files === right.files &&
    left.lines === right.lines &&
    left.comments === right.comments
  );
}

function describe(profile: Profile | undefined): string {
  if (profile === undefined) return "an unstated profile";
  return `${profile.repos} repositories, ${profile.files} files, ${profile.lines} lines, ${profile.comments} comments`;
}
