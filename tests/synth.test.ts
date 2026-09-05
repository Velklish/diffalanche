import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES, type SynthReport } from "../scripts/synth.ts";

const SMALL = PROFILES.small;
const REPOS = "repos/core/cargos-api";

/** Every file of a tree, relative and sorted, with anything under `.git` left out. */
function tree(root: string, base = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (entry.name === ".git") {
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...tree(path, base));
    } else {
      out.push(relative(base, path));
    }
  }
  return out;
}

let first: string;
let second: string;
let report: SynthReport;

beforeAll(() => {
  first = mkdtempSync(join(tmpdir(), "diffalanche-synth-"));
  second = mkdtempSync(join(tmpdir(), "diffalanche-synth-"));
  report = generate({ out: first, seed: 42, profile: SMALL });
  generate({ out: second, seed: 42, profile: SMALL });
}, 120_000);

afterAll(() => {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
});

describe("synthetic review", () => {
  it("hits the profile counts exactly", () => {
    expect(report.changeSet).toEqual({ files: SMALL.files, lines: SMALL.lines });
    expect(report.comments).toBe(SMALL.comments);
  });

  it("splits the change set between tracked edits and untracked files", () => {
    expect(report.untracked.files).toBe(SMALL.repos);
    expect(report.tracked.files).toBe(SMALL.files - SMALL.repos);
    expect(report.tracked.lines + report.untracked.lines).toBe(SMALL.lines);
  });

  it("lists one repository more than the review shows: the sibling worktree", () => {
    expect(report.repositories).toBe(SMALL.repos + 1);
    expect(statSync(join(first, "repos/core/cargos-api-worktree/.git")).isFile()).toBe(true);
    const status = execFileSync(
      "git",
      ["-C", join(first, "repos/core/cargos-api-worktree"), "status", "--porcelain"],
      {
        encoding: "utf8",
      },
    );
    expect(status).toBe("");
  });

  it("nests a submodule inside a repository", () => {
    const modules = readFileSync(join(first, REPOS, ".gitmodules"), "utf8");
    expect(modules).toContain("path = vendor/lib");
    // A relative url keeps the fixture independent of where it was generated.
    expect(modules).toContain("url = ../../../sources/vendor-lib");
    expect(statSync(join(first, REPOS, "vendor/lib/.git")).isFile()).toBe(true);
  });

  it("leaves untracked files untracked", () => {
    const status = execFileSync(
      "git",
      ["-C", join(first, REPOS), "status", "--porcelain", "--untracked-files=all"],
      { encoding: "utf8" },
    );
    expect(status.split("\n").filter((row) => row.startsWith("?? ")).length).toBe(1);
  });

  it("writes the session in the on-disk format", () => {
    const dir = join(first, ".diffalanche/reviews/synth");
    const review = JSON.parse(readFileSync(join(dir, "review.json"), "utf8"));
    expect(review).toMatchObject({ version: 1, name: "synth", base: { mode: "head" } });

    const { version, comments } = JSON.parse(readFileSync(join(dir, "comments.json"), "utf8"));
    expect(version).toBe(1);
    expect(comments).toHaveLength(SMALL.comments);
    expect(readdirSync(dir).sort()).toEqual(["comments.json", "review.json"]);
  });

  it("anchors every line comment on the line it names", () => {
    const path = join(first, ".diffalanche/reviews/synth/comments.json");
    const { comments } = JSON.parse(readFileSync(path, "utf8"));
    const anchored = comments.filter((c: { line: number | null }) => c.line !== null);
    expect(anchored.length).toBeGreaterThan(0);
    for (const comment of anchored) {
      const file = readFileSync(join(first, comment.repo, comment.path), "utf8").split("\n");
      expect(file[comment.line - 1]).toBe(comment.anchor.lineContent);
    }
  });

  it("refuses a directory it did not write, and leaves it untouched", () => {
    const foreign = mkdtempSync(join(tmpdir(), "diffalanche-foreign-"));
    writeFileSync(join(foreign, "not-ours.txt"), "keep me");
    try {
      expect(() => generate({ out: foreign, profile: SMALL })).toThrow(/no \.diffalanche/);
      expect(readdirSync(foreign)).toEqual(["not-ours.txt"]);
      expect(readFileSync(join(foreign, "not-ours.txt"), "utf8")).toBe("keep me");
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
  });

  it("overwrites a directory carrying the marker of an earlier run", () => {
    const stale = mkdtempSync(join(tmpdir(), "diffalanche-stale-"));
    mkdirSync(join(stale, ".diffalanche"));
    writeFileSync(join(stale, "leftover.txt"), "from the run before");
    try {
      const again = generate({ out: stale, seed: 42, profile: SMALL });
      expect(again.changeSet).toEqual({ files: SMALL.files, lines: SMALL.lines });
      expect(readdirSync(stale)).not.toContain("leftover.txt");
    } finally {
      rmSync(stale, { recursive: true, force: true });
    }
  }, 120_000);

  it("produces byte-identical trees for the same seed", () => {
    const paths = tree(first);
    // Without this the comparison below passes on two empty listings.
    expect(paths.length).toBeGreaterThan(SMALL.files);
    expect(tree(second)).toEqual(paths);
    for (const path of paths) {
      expect(readFileSync(join(second, path))).toEqual(readFileSync(join(first, path)));
    }
  });
});
