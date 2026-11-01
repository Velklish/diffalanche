import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanReview } from "../src/core/change-set.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { addComment, createSession, get } from "../src/core/domain/index.ts";
import { fileSourceAt } from "../src/core/git/browse.ts";
import { scan } from "../src/core/scanner/index.ts";
import { writeDiffCache } from "../src/core/storage/index.ts";
import { createActivityLog, createEventBus, startWatcher } from "../src/core/watcher/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "diffalanche-reanchor-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.test");
  const text = "const before = 1;\nconst anchor = 42;\nconst after = 3;\n";
  const file = join(repo, "a.ts");
  writeFileSync(file, text);
  git("add", ".");
  git("commit", "-qm", "base");
  writeFileSync(file, `${text}const added = 4;\n`);
  const config = await loadConfig({ root, dataDir: join(root, "data") }, root, {
    env: {}, configHome: join(root, "config"),
  });
  await createSession(config.dataDir, "work", { mode: "head" });
  const scanned = await scanReview(config, { mode: "head" });
  await writeDiffCache(config.dataDir, "work", scanned.cache);
  const comment = await addComment(config.dataDir, "work", {
    repo: "repo", path: "a.ts", line: 2, severity: "warning", body: "keep this thread",
    author: "human", role: "human",
  }, { source: fileSourceAt(root) });
  return { root, repo, file, text, git, config, scanned, comment };
}

describe("re-anchoring through public refresh", () => {
  it("moves an existing comment five lines before refresh resolves", async () => {
    const f = await fixture();
    const watching = await startWatcher({
      config: f.config, scan: await scan(f.root, { roots: [f.root], depth: 2, exclude: [] }), bus: createEventBus(), activity: createActivityLog(),
      recursive: true,
      native: () => ({ polling: false, ready: Promise.resolve(), close: () => undefined }),
    });
    try {
      writeFileSync(f.file, `// 1\n// 2\n// 3\n// 4\n// 5\n${f.text}const added = 4;\n`);
      await watching.refresh();
      expect((await get(f.config.dataDir, "work", f.comment.id)).line).toBe(7);
    } finally {
      await watching.close();
    }
  });
});
