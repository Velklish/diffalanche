import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession } from "../src/core/domain/index.ts";
import { GIT_NULL } from "../src/core/git/run.ts";
import type { RepositoryChange } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { closeApp, createApp } from "../src/server/app.ts";
import { createEventStream } from "../src/server/events.ts";
import { type CandidateSet, createReviewService, type ScanSummary } from "../src/server/review.ts";

it("documents HTTP file exclusions for named diffs, candidates and scan counts", () => {
  const reference = readFileSync(
    new URL("../docs/reference/07-server.md", import.meta.url),
    "utf8",
  );
  expect(reference.includes("scope and `Config.exclude`")).toBe(true);
  expect(reference.includes("ignoring the task's scope does not bypass file exclusions")).toBe(
    true,
  );
  expect(reference.includes("whose changes are all excluded remains listed with `files: 0`")).toBe(
    true,
  );
});

describe("HTTP change-set file exclusions", () => {
  let root: string;
  let app: ReturnType<typeof createApp>;
  let before: Record<string, string>;

  function snapshot(): Record<string, string> {
    const hashes: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else
          hashes[relative(root, path)] = createHash("sha256")
            .update(readFileSync(path))
            .digest("hex");
      }
    };
    for (const repo of ["mixed", "excluded", "outside"]) walk(join(root, repo));
    return hashes;
  }

  async function body<T>(route: string): Promise<T> {
    const response = await app.request(route);
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "diffalanche-http-exclude-"));
    for (const repo of ["mixed", "excluded", "outside"]) {
      const cwd = join(root, repo);
      mkdirSync(join(cwd, "generated"), { recursive: true });
      writeFileSync(join(cwd, "package.lock"), "old lock\n");
      writeFileSync(join(cwd, "visible.ts"), "old source\n");
      writeFileSync(join(cwd, "generated/out.ts"), "old generated\n");
      writeFileSync(join(cwd, ".gitignore"), "ignored.tmp\n");
      const git = (...args: string[]) =>
        execFileSync("git", args, {
          cwd,
          env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: GIT_NULL,
            GIT_CONFIG_SYSTEM: GIT_NULL,
            GIT_CONFIG_NOSYSTEM: "1",
          },
          stdio: "ignore",
        });
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git(
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.com",
        "commit",
        "-qm",
        "initial",
      );
      writeFileSync(join(cwd, "package.lock"), "new lock\n");
      writeFileSync(join(cwd, "generated/out.ts"), "new generated\n");
      writeFileSync(join(cwd, "ignored.tmp"), "ignored\n");
      if (repo !== "excluded") writeFileSync(join(cwd, "visible.ts"), "new source\n");
    }
    const config = { ...(await loadConfig({ root })), exclude: ["**/*.lock", "generated/"] };
    await createSession(config.dataDir, "main", { mode: "head" });
    await createSession(config.dataDir, "named", { mode: "head" }, undefined, {
      use: false,
      scope: [
        { repo: "mixed", paths: ["package.lock", "visible.ts"] },
        { repo: "excluded", paths: null },
      ],
    });
    app = createApp({
      config,
      review: createReviewService(config),
      activity: createActivityLog(),
      events: createEventStream(),
      ui: { read: async () => null },
    });
    before = snapshot();
  });

  afterEach(async () => {
    try {
      expect(snapshot()).toEqual(before);
    } finally {
      await closeApp(app);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("filters named repository diffs while retaining visible files and scope", async () => {
    const current = await body<RepositoryChange>("/api/repos/mixed/diff");
    expect(current.files.map((file) => file.path)).toEqual(["visible.ts"]);
    const named = await body<RepositoryChange>("/api/repos/mixed/diff?review=named");
    expect(named.files.map((file) => file.path)).toEqual(["visible.ts"]);
    expect((await app.request("/api/repos/outside/diff?review=named")).status).toBe(404);
  });

  it("filters candidates across the whole root while ignoring the named scope", async () => {
    const candidates = await body<CandidateSet>("/api/sessions/candidates?review=named");
    expect(
      candidates.repositories.map((repo) => ({
        path: repo.path,
        files: repo.files.map((file) => file.path),
      })),
    ).toEqual([
      { path: "mixed", files: ["visible.ts"] },
      { path: "outside", files: ["visible.ts"] },
    ]);
  });

  it("counts visible files and reports excluded-only repositories as unchanged", async () => {
    const summary = await body<ScanSummary>("/api/scan");
    expect(
      summary.repositories.map(({ path, files, hasChanges }) => ({ path, files, hasChanges })),
    ).toEqual([
      { path: "excluded", files: 0, hasChanges: false },
      { path: "mixed", files: 1, hasChanges: true },
      { path: "outside", files: 1, hasChanges: true },
    ]);
  });

  it("returns 404 for a named repository with only excluded changes", async () => {
    expect((await app.request("/api/repos/excluded/diff?review=named")).status).toBe(404);
  });
});
