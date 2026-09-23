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
import { SCAN_CONCURRENCY, scanReview } from "../src/core/change-set.ts";
import type { Config } from "../src/core/config/index.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession } from "../src/core/domain/index.ts";
import { readCurrent, writeCurrent } from "../src/core/storage/index.ts";
import { createReviewService } from "../src/server/review.ts";
import { startReviewServer } from "../src/server/serve.ts";

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
let argvPath: string;
let lifePath: string;
let slow: string;

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

/** The git subcommands one run started, without repeats: the first word of each recorded argv
 * that is not a global option, which is where `-c key=value` and `--no-pager` sit (ADR-012). */
function subcommands(): string[] {
  const lines = readFileSync(argvPath, "utf8").split("\n").filter(Boolean);
  const names = new Set<string>();
  for (const line of lines) {
    const words = line.split(" ");
    let at = 0;
    while (at < words.length) {
      const word = words[at] ?? "";
      if (word === "-c" || word === "-C") at += 2;
      else if (word.startsWith("-")) at += 1;
      else break;
    }
    const name = words[at];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
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
  writeFileSync(argvPath, "");
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
  argvPath = join(shim, "argv.log");
  lifePath = join(shim, "life.log");
  writeFileSync(logPath, "");
  writeFileSync(argvPath, "");
  writeFileSync(lifePath, "");
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const script = join(shim, "git");
  // `PWD` is unset for the `pwd`: a shell inherits it from whoever started it,
  // and what is wanted is the directory git was actually run in.
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$(unset PWD; pwd)" >> "${logPath}"\n` +
      `printf '%s\\n' "$*" >> "${argvPath}"\n` +
      `printf '+\\n' >> "${lifePath}"\n${real} "$@"\nstatus=$?\nprintf -- '-\\n' >> "${lifePath}"\nexit $status\n`,
  );
  chmodSync(script, 0o755);

  // The same shim with a pause, so the peak is not a race the machine decides
  // (`docs/reference/02-git.md`, the change-set section).
  slow = mkdtempSync(join(tmpdir(), "diffalanche-git-slow-"));
  const slowScript = join(slow, "git");
  writeFileSync(
    slowScript,
    `#!/bin/sh\nprintf '+\\n' >> "${lifePath}"\nsleep 0.05\n${real} "$@"\n` +
      `status=$?\nprintf -- '-\\n' >> "${lifePath}"\nexit $status\n`,
  );
  chmodSync(slowScript, 0o755);
}, 300_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(shim, { recursive: true, force: true });
  rmSync(slow, { recursive: true, force: true });
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

  /** What the scan is allowed to run: a subcommand that writes is what the old status-only guard
   * could not see (DA-65, `docs/reference/02-git.md`). */
  it("runs only the subcommands that read", async () => {
    await count(() => scanReview(config, { mode: "head" }));
    expect(subcommands()).toEqual(["config", "diff-index", "ls-files", "rev-parse"]);
  }, 300_000);

  /** The peak of git processes one run held open at once, from the shim's two streams. */
  async function peakOf(run: () => Promise<unknown>): Promise<number> {
    writeFileSync(lifePath, "");
    const before = process.env.PATH;
    process.env.PATH = `${slow}:${before ?? ""}`;
    try {
      await run();
    } finally {
      if (before === undefined) process.env.PATH = "";
      else process.env.PATH = before;
    }
    let live = 0;
    let peak = 0;
    for (const line of readFileSync(lifePath, "utf8").split("\n").filter(Boolean)) {
      if (line === "+") live += 1;
      else live -= 1;
      peak = Math.max(peak, live);
    }
    return peak;
  }

  /** A read holds at most three processes of its own — branch, base, drivers ([02-git.md]). */
  const CEILING = SCAN_CONCURRENCY * 4;

  // Each of the three call sites, because a cap on one says nothing about the others (DA-98).
  const sites: [string, () => Promise<unknown>][] = [
    ["scanReview", () => scanReview(config, { mode: "head" })],
    ["summary", () => createReviewService(config).summary()],
    ["candidates", () => createReviewService(config).candidates()],
  ];
  for (const [name, run] of sites) {
    it(`reads at most SCAN_CONCURRENCY repositories at once in ${name}`, async () => {
      expect(PROFILE.repos).toBeGreaterThan(SCAN_CONCURRENCY);
      const peak = await peakOf(run);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(CEILING);
    }, 300_000);
  }

  it("starts a server reading the repositories of the current task's scope and no others", async () => {
    const previous = await readCurrent(config.dataDir);
    const scope = SCOPED.map((repo) => ({ repo, paths: null }));
    await createSession(config.dataDir, "two-of-many", { mode: "head" }, undefined, { scope });
    try {
      // The start reads the working tree once, and a task over two repositories pays for two.
      const started = await count(async () => {
        const server = await startReviewServer({ config: { ...config, port: 0 } });
        await server.close();
      });
      expect(started.touched).toEqual([...SCOPED].sort());
    } finally {
      if (previous !== null) await writeCurrent(config.dataDir, previous);
    }
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
