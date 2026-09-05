/**
 * The commands of DA-13 on a fixture root: sessions, the change set, the exit
 * codes, and the usage. `run` is called in process because it is what the two
 * entry points call and what returns the exit code; the two-process case that
 * only a real process can show is in `tests/cli-comments.test.ts`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/run.ts";
import { VERSION } from "../src/cli/version.ts";
import type { UiAssets } from "../src/server/assets.ts";
import { makeRoot, REPOS } from "./helpers/fixture-root.ts";

const noUi: UiAssets = { read: async () => null };

let root: string;

type Result = { code: number; out: string; err: string };

async function invoke(...argv: string[]): Promise<Result> {
  let out = "";
  let err = "";
  const code = await run(argv, noUi, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

/** Every command of the fixture run takes the same `--root`. */
async function inRoot(...argv: string[]): Promise<Result> {
  return invoke(...argv, "--root", root);
}

function dataFile(...parts: string[]): string {
  return join(root, ".diffalanche", ...parts);
}

/** The describes that work on a review build a fixture root; the usage one does not. */
function useFixtureRoot(): void {
  beforeEach(() => {
    root = makeRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
}

describe("usage", () => {
  it("prints the version of the package", async () => {
    for (const argv of [["version"], ["--version"]]) {
      const result = await invoke(...argv);
      expect(result).toMatchObject({ code: 0, err: "" });
      expect(result.out.trim()).toBe(VERSION);
    }
  });

  it("lists every command of docs/SPEC.md section 8 that exists", async () => {
    for (const argv of [[], ["--help"], ["-h"], ["help"]]) {
      const result = await invoke(...argv);
      expect(result).toMatchObject({ code: 0, err: "" });
      for (const command of [
        "serve",
        "review new",
        "review use",
        "review list",
        "review base",
        "diff",
      ]) {
        expect(result.out).toContain(command);
      }
    }
  });

  it("prints the options of one command from the definitions it parses with", async () => {
    const result = await invoke("diff", "--help");
    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toContain("diffalanche diff");
    expect(result.out).toContain("--repo <path>");
    expect(result.out).toContain("--json");
    // The global flags are on every command, printed from the one definition.
    expect(result.out).toContain("--review <name>");
    expect(result.out).toContain("--data-dir <dir>");
  });

  it("refuses an unknown command with exit code 1 and one line on stderr", async () => {
    const result = await invoke("nope");
    expect(result.code).toBe(1);
    expect(result.err).toContain("unknown command: nope");
    expect(result.err.trimEnd().split("\n")).toHaveLength(1);
    expect(result.out).toBe("");
  });

  it("answers a command group with its subcommands", async () => {
    for (const argv of [["review"], ["review", "nwe"]]) {
      const result = await invoke(...argv);
      expect(result.code).toBe(1);
      expect(result.err).toContain("review needs a subcommand: new, use, list, base");
      expect(result.out).toBe("");
    }
    const help = await invoke("review", "--help");
    expect(help).toMatchObject({ code: 0, err: "" });
    expect(help.out).toContain("diffalanche review <subcommand>");
    expect(help.out).toContain("base <head|branch|branch:<name>|<ref>>");
  });

  it("refuses an unknown flag and a missing argument with exit code 1", async () => {
    const unknown = await invoke("diff", "--nope");
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain("--nope");

    const missing = await invoke("review", "new");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("<name> is required");
  });
});

describe("review sessions", () => {
  useFixtureRoot();

  it("creates a session, makes it current, and lists it", async () => {
    const created = await inRoot(
      "review",
      "new",
      "alpha",
      "--base",
      "branch:origin/main",
      "--title",
      "Cargo flags",
    );
    expect(created).toMatchObject({ code: 0, err: "" });
    expect(created.out).toContain("alpha");

    expect(
      JSON.parse(readFileSync(dataFile("reviews", "alpha", "review.json"), "utf8")),
    ).toMatchObject({
      name: "alpha",
      title: "Cargo flags",
      base: { mode: "branch", branch: "origin/main" },
    });
    expect(readFileSync(dataFile("current"), "utf8")).toBe("alpha\n");

    const listed = await inRoot("review", "list", "--json");
    expect(listed).toMatchObject({ code: 0, err: "" });
    expect(JSON.parse(listed.out)).toMatchObject({
      sessions: [{ name: "alpha", current: true, open: 0, resolved: 0, repositories: null }],
      warnings: [],
    });
  });

  it("defaults the base to head and prints a table without --json", async () => {
    await inRoot("review", "new", "alpha");
    const listed = await inRoot("review", "list");
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("* alpha");
    expect(listed.out).toContain("head");
    expect(listed.out).toContain("not scanned");
  });

  it("switches the current session and changes the base of one", async () => {
    await inRoot("review", "new", "alpha");
    await inRoot("review", "new", "beta");
    expect(readFileSync(dataFile("current"), "utf8")).toBe("beta\n");

    const used = await inRoot("review", "use", "alpha");
    expect(used.code).toBe(0);
    expect(readFileSync(dataFile("current"), "utf8")).toBe("alpha\n");

    const based = await inRoot("review", "base", "branch:origin/develop");
    expect(based).toMatchObject({ code: 0, err: "" });
    expect(based.out).toContain("branch:origin/develop");
    expect(
      JSON.parse(readFileSync(dataFile("reviews", "alpha", "review.json"), "utf8")),
    ).toMatchObject({
      base: { mode: "branch", branch: "origin/develop" },
    });
    // `--review` names a session without switching to it.
    const other = await inRoot("review", "base", "head", "--review", "beta");
    expect(other.code).toBe(0);
    expect(readFileSync(dataFile("current"), "utf8")).toBe("alpha\n");
  });

  it("refuses a base that is not one of the four forms", async () => {
    const result = await inRoot("review", "new", "alpha", "--base", "branch:");
    expect(result.code).toBe(1);
    expect(result.err).toContain("names no branch");
    expect(result.out).toBe("");
    expect(existsSync(dataFile("reviews", "alpha"))).toBe(false);
  });

  it("refuses a session name that is not one, and a session that is not there", async () => {
    expect(await inRoot("review", "new", "../escape")).toMatchObject({ code: 1 });
    const missing = await inRoot("review", "use", "nothing");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no review session "nothing"');
  });

  it("refuses a name that is already a session", async () => {
    await inRoot("review", "new", "alpha");
    const again = await inRoot("review", "new", "alpha", "--title", "second try");
    expect(again.code).toBe(1);
    expect(again.err).toContain('review session "alpha" already exists');
    // The first session is untouched: the title of the refused one is not on it.
    expect(
      JSON.parse(readFileSync(dataFile("reviews", "alpha", "review.json"), "utf8")).title,
    ).toBeNull();
  });

  it("reports a directory under reviews/ that is not a review session", async () => {
    await inRoot("review", "new", "alpha");
    mkdirSync(dataFile("reviews", "leftovers"));

    const listed = await inRoot("review", "list", "--json");
    expect(listed).toMatchObject({ code: 0, err: "" });
    const printed = JSON.parse(listed.out);
    expect(printed.sessions.map((one: { name: string }) => one.name)).toEqual(["alpha"]);
    expect(printed.warnings).toHaveLength(1);
    expect(printed.warnings[0]).toContain("no review.json");

    // Without --json the warning is on stderr, so stdout stays the table.
    const table = await inRoot("review", "list");
    expect(table.err).toContain("no review.json");
    expect(table.out).toContain("* alpha");
  });

  it("refuses every session command with no current session and no --review", async () => {
    const result = await inRoot("diff", "--json");
    expect(result.code).toBe(1);
    expect(result.err).toContain("no current review session");
    expect(result.out).toBe("");
  });
});

describe("diff", () => {
  useFixtureRoot();

  beforeEach(async () => {
    await inRoot("review", "new", "alpha");
  });

  it("prints the repositories with changes as JSON and writes diff.json", async () => {
    const result = await inRoot("diff", "--json");
    expect(result).toMatchObject({ code: 0, err: "" });
    const printed = JSON.parse(result.out);
    expect(printed.repositories.map((repo: { path: string }) => repo.path)).toEqual([...REPOS]);
    expect(printed.totals).toMatchObject({ repositories: 2, files: 4 });

    // The cache is what was printed, byte for byte: `docs/SPEC.md` section 7
    // says they are one set, and two objects that parse the same could still be
    // two different files.
    const cache = readFileSync(dataFile("reviews", "alpha", "diff.json"), "utf8");
    expect(result.out).toBe(cache);
    expect(printed.base).toEqual({ mode: "head" });
    // The hunks are only in the cache and in this output; the anchor of a
    // comment is captured from them.
    expect(printed.repositories[0].files[0].hunks.length).toBeGreaterThan(0);
  });

  it("prints a unified patch without --json, and the untracked file is in it", async () => {
    const result = await inRoot("diff");
    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toContain("# repos/group/alpha");
    expect(result.out).toContain("diff --git a/file.txt b/file.txt");
    expect(result.out).toContain("+++ b/untracked.txt");
  });

  it("narrows to one repository with --repo, and the totals follow", async () => {
    const result = await inRoot("diff", "--json", "--repo", "repos/group/beta");
    expect(result.code).toBe(0);
    const printed = JSON.parse(result.out);
    expect(printed.repositories.map((repo: { path: string }) => repo.path)).toEqual([
      "repos/group/beta",
    ]);
    expect(printed.totals.repositories).toBe(1);

    // The cache keeps the whole review: a narrowed one would tell the next
    // reader that the other repositories have no changes.
    const cache = JSON.parse(readFileSync(dataFile("reviews", "alpha", "diff.json"), "utf8"));
    expect(cache.repositories).toHaveLength(2);
  });

  it("refuses a --repo the scan found no repository at, before it writes", async () => {
    const result = await inRoot("diff", "--json", "--repo", "repos/group/gamma");
    expect(result.code).toBe(1);
    expect(result.err).toContain('no repository "repos/group/gamma" under the root');
    expect(result.out).toBe("");
    // The cache is not rewritten on the way out of a mistyped flag.
    expect(existsSync(dataFile("reviews", "alpha", "diff.json"))).toBe(false);
  });

  it("prints an empty change set for a repository that has none", async () => {
    execFileSync("git", ["checkout", "--", "file.txt"], { cwd: join(root, REPOS[1]) });
    rmSync(join(root, REPOS[1], "untracked.txt"));
    const result = await inRoot("diff", "--json", "--repo", REPOS[1]);
    expect(result).toMatchObject({ code: 0, err: "" });
    expect(JSON.parse(result.out)).toMatchObject({
      repositories: [],
      totals: { repositories: 0, files: 0, lines: 0 },
    });
  });

  it("rescans instead of patching a cache computed against another base", async () => {
    const first = JSON.parse((await inRoot("diff", "--json")).out);
    expect(first.base).toEqual({ mode: "head" });
    await inRoot("review", "base", "branch:origin/main");
    const second = JSON.parse((await inRoot("diff", "--json")).out);
    expect(second.base).toEqual({ mode: "branch", branch: "origin/main" });
  });

  it("refuses --json and --patch together", async () => {
    const result = await inRoot("diff", "--json", "--patch");
    expect(result.code).toBe(1);
    expect(result.err).toContain("--json and --patch");
  });

  it("keeps the warnings of a base that did not resolve out of the JSON on stdout", async () => {
    await inRoot("review", "base", "branch:origin/main");
    const result = await inRoot("diff", "--json");
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    const printed = JSON.parse(result.out);
    // No remote in the fixture: `branch` falls back to `head` and says so.
    expect(printed.warnings.length).toBeGreaterThan(0);
    expect(printed.repositories).toHaveLength(2);

    const patched = await inRoot("diff");
    expect(patched.code).toBe(0);
    expect(patched.err).toContain("warning: repos/group/alpha");
  });
});

describe("the directory flags", () => {
  useFixtureRoot();

  it("refuses a --root that is not there and a --data-dir that is a file", async () => {
    const missing = await invoke("review", "list", "--root", join(root, "typo"));
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("--root: no such directory");
    // A typo must not leave a data directory behind inside it.
    expect(existsSync(join(root, "typo"))).toBe(false);

    const file = join(root, "not-a-directory");
    writeFileSync(file, "");
    const notADirectory = await inRoot("review", "new", "alpha", "--data-dir", file);
    expect(notADirectory.code).toBe(1);
    expect(notADirectory.err).toContain("is not a directory");
  });

  it("takes a --data-dir that does not exist yet: the tool creates that one", async () => {
    const elsewhere = join(root, "somewhere", "new");
    const created = await inRoot("review", "new", "alpha", "--data-dir", elsewhere);
    expect(created).toMatchObject({ code: 0, err: "" });
    expect(existsSync(join(elsewhere, "reviews", "alpha", "review.json"))).toBe(true);
  });
});

describe("exit code 2", () => {
  useFixtureRoot();

  it("prints a stack trace for what no layer claims", async () => {
    await inRoot("review", "new", "alpha");
    // A directory where `review.json` should be: reading it is EISDIR, which
    // neither the domain nor storage turns into an answer.
    rmSync(dataFile("reviews", "alpha", "review.json"));
    mkdirSync(dataFile("reviews", "alpha", "review.json"));
    const result = await inRoot("review", "use", "alpha");
    expect(result.code).toBe(2);
    expect(result.err).toContain("at ");
    expect(result.out).toBe("");
  });
});
