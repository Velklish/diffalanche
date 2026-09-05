#!/usr/bin/env bun
/**
 * The local half of a release: everything that can be checked before a tag
 * exists, and then the annotated tag itself.
 *
 *   bun run release 0.1.0
 *   bun run release 0.1.0 -- --dry-run
 *
 * It never pushes. Pushing the tag is the owner's step, and that push is the
 * only thing `.github/workflows/release.yml` reacts to — so everything this
 * script checks is checked while nothing has been published yet. See
 * [docs/reference/11-perf.md](../docs/reference/11-perf.md).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { argv, chdir, exit, stderr, stdout } from "node:process";

const USAGE = `Usage: bun run release <version> [-- --dry-run]

  <version>   the version to release: 0.1.0 or v0.1.0; the tag is v0.1.0
  --dry-run   run every check, print the tag command instead of running it
`;

function fail(message: string): never {
  stderr.write(`release: ${message}\n`);
  exit(1);
}

function ok(message: string): void {
  stdout.write(`  ${message}\n`);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function parse(args: string[]): { version: string; dryRun: boolean } {
  let version: string | undefined;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      stdout.write(USAGE);
      exit(0);
    } else if (arg.startsWith("-")) fail(`unknown argument: ${arg}\n\n${USAGE}`);
    else if (version !== undefined) fail(`one version at a time\n\n${USAGE}`);
    else version = arg;
  }
  if (version === undefined) fail(`which version\n\n${USAGE}`);
  const bare = version.startsWith("v") ? version.slice(1) : version;
  // Semantic versioning, the spelling `package.json` and the tag both use.
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(bare)) {
    fail(`not a version: ${version}; 0.1.0 or 0.1.0-rc.1\n\n${USAGE}`);
  }
  return { version: bare, dryRun };
}

const { version, dryRun } = parse(argv.slice(2));
const tag = `v${version}`;

stdout.write(`release ${tag}${dryRun ? " (dry run)" : ""}\n`);

// The repository root, so the script reads the same files wherever it is typed.
const root = git(["rev-parse", "--show-toplevel"]).trim();
chdir(root);

// 1. The version the tag names is the version the package declares. The tag is
//    the argument here and `GITHUB_REF_NAME` in the workflow; both are checked
//    against `package.json`, because a tag that disagrees with it publishes one
//    version under another's name.
const declared = JSON.parse(readFileSync("package.json", "utf8")).version;
if (declared !== version) {
  fail(`package.json is ${declared}, this release is ${version}; edit it and commit first`);
}
ok(`package.json is ${version}`);

// 2. A clean tree, untracked files included: the tag points at a commit, and
//    anything not in it is not in the release.
const dirty = git(["status", "--porcelain"]).trim();
if (dirty !== "") fail(`the working tree is not clean:\n${dirty}`);
ok("the working tree is clean");

// 3. On `main`. The README and the reference both say a release is a tag on
//    `main`; a tag made on a work branch would publish a commit that is not in
//    the history everyone else reads, and nothing downstream would notice.
function currentBranch(): string {
  // `--quiet` for the same reason as `tagExists`: without it git prints its own
  // `fatal:` to the terminal before the message below is written.
  try {
    return git(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
  } catch {
    return "";
  }
}
const branch = currentBranch();
if (branch !== "main") {
  fail(
    branch === ""
      ? "HEAD is detached; a release is a tag on main"
      : `the branch is ${branch}; a release is a tag on main`,
  );
}
ok("the branch is main");

// 4. The tag is not there yet. `git tag` would refuse anyway, but it refuses
//    after the test suite has run rather than before it.
function tagExists(name: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${name}`]);
    return true;
  } catch {
    return false;
  }
}
if (tagExists(tag)) fail(`${tag} already exists; delete it or release the next version`);
ok(`${tag} is free`);

// 5. The changelog has this version's section. The script does not write it:
//    moving Unreleased under a heading is an edit, an edit dirties the tree,
//    and a tag made after it would point at the commit before the edit. So the
//    section is a commit the owner makes, and this refuses until it is there.
const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
const heading = `## [${version}]`;
const start = lines.findIndex((line) => line.startsWith(heading));
if (start === -1) {
  fail(
    `CHANGELOG.md has no section for ${version}.\n` +
      `  Rename the Unreleased entries to "${heading} - ${new Date().toISOString().slice(0, 10)}",\n` +
      "  leave a fresh empty Unreleased above it, and commit that.",
  );
}
// The section is what the workflow lifts out as the release notes, and it is
// read the same way here: from under the heading to the next `## [`. A heading
// with nothing under it passes a check for the heading alone and then fails the
// workflow, after six binaries have been built and the tag is on the remote.
const after = lines.slice(start + 1);
const next = after.findIndex((line) => line.startsWith("## ["));
const notes = next === -1 ? after : after.slice(0, next);
if (!notes.some((line) => line.trim() !== "")) {
  fail(
    `CHANGELOG.md has the ${version} heading and nothing under it; the release notes would be empty`,
  );
}
if (!lines.some((line) => line.startsWith("## [Unreleased]"))) {
  fail("CHANGELOG.md has no Unreleased section; the next change has nowhere to go");
}
ok(`CHANGELOG.md has the ${version} section`);

// 6. The suite, on Node. The Bun half and the smoke matrix are CI's, on the
//    commit this tag will point at.
stdout.write("  bun run test\n");
try {
  execFileSync("bun", ["run", "test"], { stdio: "inherit" });
} catch {
  fail("the test suite failed; nothing was tagged");
}
ok("the test suite passed");

if (dryRun) {
  stdout.write(`\nEvery check passed. Without --dry-run this would run:\n`);
  stdout.write(`  git tag -a ${tag} -m "diffalanche ${version}"\n`);
  exit(0);
}

git(["tag", "-a", tag, "-m", `diffalanche ${version}`]);
stdout.write(
  `\n${tag} is tagged, locally. Nothing was pushed and nothing was published.\n` +
    `Pushing the tag is yours, and it is what starts the release workflow:\n` +
    `  git push origin ${tag}\n`,
);
