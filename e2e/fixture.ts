/**
 * The fixture the acceptance suite runs against: the small profile of the
 * synthetic review, plus the one repository `docs/SPEC.md` section 10 asks for
 * that the generator does not make — a clone with a remote, a feature branch
 * with a commit ahead of the remote default branch, and a clean working tree.
 *
 * It lives here rather than in `scripts/synth.ts` because the generator's
 * profiles are what the performance gate measures: a repository added there
 * would move the gate's numbers to prove something the gate does not check.
 * The acceptance fixture is its own directory, so `bun run test:ui` and
 * `bun run perf` keep the fixture they had.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join, resolve } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { generate, PROFILES } from "../scripts/synth.ts";

/** The repository with the remote. `tools` is a group the generator leaves free. */
export const FEATURE_REPO = "repos/tools/tariff-store";
/** Where the remote it was cloned from lives: outside `repos/`, so no scan finds it. */
const UPSTREAM = "sources/tariff-store-upstream";
export const FEATURE_BRANCH = "feature/rounding";
/**
 * A worktree checked out *inside* a repository — the other half of the sentence
 * in section 10, next to the generator's nested submodule. It is ignored by the
 * repository that holds it, so the working tree the `branch` criterion needs to
 * be clean stays clean. The test asserts the outcome — nothing under the holder
 * is listed — not which of the scanner's two guards stopped there: at this
 * layout's depth the depth limit and the no-descent rule coincide.
 */
export const NESTED_WORKTREE = `${FEATURE_REPO}/nested/inner`;
/** The file the feature branch commits, and the line only its own side carries. */
export const FEATURE_FILE = "src/tariff/rounding.ts";
export const FEATURE_LINE = "export const ROUNDING_STEP = 50;";

const GIT_USER = { name: "synth", email: "synth@diffalanche.invalid" };
const GIT_DATE = "2026-09-01T09:00:00+00:00";

const GIT_CONFIG = [
  "-c",
  "init.defaultBranch=main",
  "-c",
  `user.name=${GIT_USER.name}`,
  "-c",
  `user.email=${GIT_USER.email}`,
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.autocrlf=false",
  "-c",
  "protocol.file.allow=always",
];

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: GIT_USER.name,
  GIT_AUTHOR_EMAIL: GIT_USER.email,
  GIT_AUTHOR_DATE: GIT_DATE,
  GIT_COMMITTER_NAME: GIT_USER.name,
  GIT_COMMITTER_EMAIL: GIT_USER.email,
  GIT_COMMITTER_DATE: GIT_DATE,
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...GIT_CONFIG, ...args], {
    env: GIT_ENV,
    encoding: "utf8",
  });
}

function write(path: string, lines: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

/**
 * The clone and its feature branch. In `head` mode the repository has nothing
 * to show — its working tree is clean — and in `branch` mode the commit the
 * branch is ahead by is the whole change set. That difference is the criterion.
 */
function addFeatureRepository(out: string): void {
  const upstream = join(out, UPSTREAM);
  mkdirSync(upstream, { recursive: true });
  git(upstream, "init", "-q");
  write(join(upstream, FEATURE_FILE), [
    "/** Tariffs are quoted to the nearest whole unit. */",
    "export function round(value: number): number {",
    "  return Math.round(value);",
    "}",
  ]);
  // On the upstream side, so the feature branch's diff against the merge base
  // is the one file it changed and nothing else.
  write(join(upstream, ".gitignore"), ["/nested/"]);
  git(upstream, "add", "-A");
  git(upstream, "commit", "-q", "-m", "tariff rounding");

  const clone = join(out, FEATURE_REPO);
  mkdirSync(dirname(clone), { recursive: true });
  // A clone records `refs/remotes/origin/HEAD`, which is where `branch` mode
  // reads the remote default branch from when the session names no branch
  // ([02-git.md](../docs/reference/02-git.md)).
  execFileSync("git", [...GIT_CONFIG, "clone", "-q", upstream, clone], { env: GIT_ENV });
  git(clone, "checkout", "-q", "-b", FEATURE_BRANCH);
  write(join(clone, FEATURE_FILE), [
    "/** Tariffs are quoted to the nearest whole unit. */",
    FEATURE_LINE,
    "",
    "export function round(value: number): number {",
    "  return Math.round(value / ROUNDING_STEP) * ROUNDING_STEP;",
    "}",
  ]);
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "round to the tariff step");

  git(clone, "worktree", "add", "-q", "-b", "nested-worktree", "nested/inner", "HEAD");
}

export function buildFixture(out: string): void {
  generate({ out, profile: PROFILES.small });
  addFeatureRepository(resolve(out));
}

function isMain(): boolean {
  const entry = argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const out = argv[2] ?? ".perf/acceptance";
  buildFixture(out);
  stdout.write(
    `acceptance fixture at ${resolve(out)}, with ${FEATURE_REPO} on ${FEATURE_BRANCH}\n`,
  );
}
