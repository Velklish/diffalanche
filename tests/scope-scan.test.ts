/**
 * What a scoped scan costs, measured in git processes rather than in seconds
 * (DA-53): a task over two repositories of the synthetic review's twenty-one
 * must start no git process for the other nineteen. Wall-clock time would say
 * the same thing on a fast machine and something else on a loaded one; the
 * number of processes says it either way.
 *
 * The count comes from a `git` of the test's own, first on `PATH`, that writes
 * the directory it was run in and then hands over to the real one. Everything
 * the tool runs goes through `execFile("git", …)`
 * ([02-git.md](../docs/reference/02-git.md)), so nothing escapes it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { scanReview } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";

/**
 * The twenty-one repositories of the synthetic review (`docs/SPEC.md` section
 * 6), with the content of the small one. What is counted here is git processes,
 * and a process costs the same over four changed lines as over four thousand:
 * carrying the full thirty thousand would only make the suite slower and the
 * machine busier while the watcher next door measures latency.
 */
const PROFILE = { ...PROFILES.small, repos: PROFILES.full.repos };
/** Two of the twenty-one, by the names the generator gives its first repositories. */
const SCOPED = ["repos/core/cargos-api", "repos/platform/loads-search"];

let root: string;
/** The root with every symbolic link resolved: what the shim reports from inside it. */
let realRoot: string;
let shim: string;
let config: Config;
let logPath: string;

/** The repositories a run of the scan started a git process in, without repeats. */
function touched(): string[] {
  const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  const repositories = new Set<string>();
  for (const line of lines) {
    const inside = relative(realRoot, resolve(line));
    if (inside === "" || inside.startsWith("..")) continue;
    repositories.add(inside.split("/").slice(0, 3).join("/"));
  }
  return [...repositories].sort();
}

/**
 * Counts the git processes of one scan and nothing else. `PATH` carries the
 * shim only while `scan` runs and is put back in `finally`, so no other test
 * file of this worker can inherit it — a `beforeAll` that installed it for the
 * length of the file would leave it behind the moment anything in that hook
 * threw.
 */
async function count<T>(scan: () => Promise<T>): Promise<{ result: T; touched: string[] }> {
  writeFileSync(logPath, "");
  const before = process.env.PATH;
  process.env.PATH = `${shim}:${before ?? ""}`;
  try {
    const result = await scan();
    return { result, touched: touched() };
  } finally {
    if (before === undefined) process.env.PATH = "";
    else process.env.PATH = before;
  }
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-scope-scan-"));
  // On macOS the temporary directory is reached through a symbolic link, and a
  // process started inside it reports the path it really has.
  realRoot = realpathSync(root);
  generate({ out: root, seed: 3, profile: PROFILE });
  // Loaded before the shim is in place: the configuration reads
  // `git config user.name` when the file names no user, and that call is not
  // part of what a scan costs.
  config = await loadConfig({ root });

  shim = mkdtempSync(join(tmpdir(), "diffalanche-git-shim-"));
  logPath = join(shim, "calls.log");
  writeFileSync(logPath, "");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const script = join(shim, "git");
  // `PWD` is unset for the `pwd`: a shell inherits it from whoever started it,
  // and what is wanted is the directory git was actually run in.
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$(unset PWD; pwd)" >> "${logPath}"\nexec ${real} "$@"\n`,
  );
  chmodSync(script, 0o755);
}, 300_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(shim, { recursive: true, force: true });
});

// The shim is a `/bin/sh` script, so the count is taken where the tool is
// verified: Windows ships untested (`docs/SPEC.md` section 12).
describe.skipIf(process.platform === "win32")("the cost of a scoped scan", () => {
  it("is measured by a shim that sees every git process the scan starts", async () => {
    const whole = await count(() => scanReview(config, { mode: "head" }));
    // The probe is real: without a scope every repository of the review is
    // read, so a scoped run that touched them all would be caught here.
    expect(whole.touched.length).toBeGreaterThanOrEqual(PROFILE.repos);
    // And the shim is gone the moment the scan is over.
    expect(process.env.PATH ?? "").not.toContain(shim);
  }, 300_000);

  it("starts git in the repositories of the scope and in no others", async () => {
    const scope = SCOPED.map((repo) => ({ repo, paths: null }));
    const scoped = await count(() => scanReview(config, { mode: "head" }, scope));
    expect(scoped.touched).toEqual([...SCOPED].sort());
    expect(scoped.result.cache.repositories.map((one) => one.path).sort()).toEqual(
      [...SCOPED].sort(),
    );
  }, 300_000);
});
