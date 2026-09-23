/** The symbol index (DA-39): tree-sitter over the working trees, definitions by name with fuzzy
 * matching, the files `diff-changed` names read again, and 300 files inside the recorded time. */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate, PROFILES } from "../scripts/synth.ts";
import { findRepositories } from "../src/core/change-set.ts";
import { loadConfig } from "../src/core/config/index.ts";
import { createSession } from "../src/core/domain/index.ts";
import { BUNDLED_LANGUAGES, createSymbolIndex, matchScore } from "../src/core/ml/symbols/index.ts";
import type { SymbolSearch } from "../src/core/types.ts";
import { createActivityLog } from "../src/core/watcher/index.ts";
import { createApp } from "../src/server/app.ts";
import { createEventStream } from "../src/server/events.ts";
import { createReviewService } from "../src/server/review.ts";
import { SYMBOL_INDEX_BUDGET_MS } from "../src/server/routes/search.ts";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  });
}

/** Every file of a repository of the fixture whose name ends so, with its text. */
function filesOf(dir: string, extension: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(join(dir, at), { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(extension))
        out.push({ path, text: readFileSync(join(dir, path), "utf8") });
    }
  };
  walk("");
  return out;
}

/** The first line of any file that matches, as `{ path, line, name }`. */
function firstDefinition(dir: string, extension: string, pattern: RegExp) {
  for (const file of filesOf(dir, extension)) {
    const lines = file.text.split("\n");
    const at = lines.findIndex((line) => pattern.test(line));
    const name = at < 0 ? undefined : pattern.exec(lines[at] as string)?.[1];
    if (name !== undefined) return { path: file.path, line: at + 1, name };
  }
  throw new Error(`no ${pattern} in any ${extension} file of ${dir}`);
}

let root: string;
let app: Hono;
let repos: string[];

/** Repositories as the index is handed them, with no change set to compare against. */
const views = (paths: readonly string[]) => paths.map((path) => ({ path, files: [] }));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-symbols-"));
  generate({ out: root, seed: 7, profile: PROFILES.small });
  const config = await loadConfig({ root });
  repos = await findRepositories(config);
  app = createApp({
    activity: createActivityLog(),
    config,
    events: createEventStream(),
    review: createReviewService(config),
    ui: { read: async () => null },
  });
  expect((await app.request("/api/review")).status).toBe(200);
}, 120_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the index of the synthetic review", () => {
  it("finds a C# class and a TypeScript function by name, where they are defined", async () => {
    const index = createSymbolIndex({ root, languages: BUNDLED_LANGUAGES });
    for (const [extension, pattern, kind] of [
      [".cs", /public sealed class (\w+)/, "class"],
      [".ts", /export function (\w+)/, "function"],
    ] as const) {
      const repo = repos.find((one) => filesOf(join(root, one), extension).length > 0);
      if (repo === undefined) throw new Error(`the fixture has no ${extension} file`);
      const known = firstDefinition(join(root, repo), extension, pattern);
      const [hit] = await index.query(views(repos), known.name, 5);
      expect(hit).toMatchObject({
        repo,
        path: known.path,
        line: known.line,
        name: known.name,
        kind,
      });
    }
  });

  it("answers the server's route with the definition and the lines around it", async () => {
    const repo = repos.find((one) => filesOf(join(root, one), ".cs").length > 0) as string;
    const known = firstDefinition(join(root, repo), ".cs", /public sealed class (\w+)/);
    const response = await app.request(`/api/search/symbols?q=${known.name.toLowerCase()}`);
    const result = (await response.json()) as SymbolSearch;
    expect(result.hits[0]).toMatchObject({
      repo,
      path: known.path,
      line: known.line,
      kind: "class",
    });
    expect(result.hits[0]?.text).toContain(`class ${known.name}`);
    expect(result.hits[0]?.after.length).toBeGreaterThan(0);
  });
});

describe("matching a name", () => {
  it("ranks the whole name over its start, its start over its middle, and letters in order last", () => {
    const scores = [
      "CargoService",
      "CargoServiceFactory",
      "OldCargoService",
      "CacheRegistrarGo",
    ].map((name) => matchScore(name, "cargoservice"));
    expect(scores[0]).toBeGreaterThan(scores[1] as number);
    expect(scores[1]).toBeGreaterThan(scores[2] as number);
    expect(matchScore("ControllerService", "ctrlsvc")).toBeGreaterThan(0);
    expect(matchScore("CargoService", "xyz")).toBe(0);
  });
});

/** A repository of one commit under a root of its own; the files are written after the commit. */
function oneRepository(files: Record<string, string>): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "diffalanche-symbols-one-"));
  const repo = join(dir, "repos", "g", "one");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(dir, ".diffalanche"), { recursive: true });
  writeFileSync(join(dir, ".diffalanche", "config.json"), '{ "roots": ["repos"], "depth": 2 }\n');
  writeFileSync(join(repo, "README.md"), "# one\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "-c", "user.email=f@example.com", "-c", "user.name=f", "commit", "-qm", "init");
  for (const [path, text] of Object.entries(files)) writeFileSync(join(repo, path), text);
  return { dir, repo };
}

describe("keeping it fresh", () => {
  it("reads again the files a frame names, and a gone one leaves", async () => {
    const { dir, repo } = oneRepository({ "a.ts": "export function before() {}\n" });
    try {
      const index = createSymbolIndex({ root: dir, languages: BUNDLED_LANGUAGES });
      const one = views(["repos/g/one"]);
      expect((await index.query(one, "before", 5)).map((hit) => hit.name)).toEqual(["before"]);
      writeFileSync(join(repo, "a.ts"), "export function after() {}\n");
      writeFileSync(join(repo, "b.py"), "def added():\n  pass\n");
      await index.changed("repos/g/one", ["a.ts", "b.py", "README.md"]);
      expect(await index.query(one, "before", 5)).toEqual([]);
      expect((await index.query(one, "after", 5))[0]?.path).toBe("a.ts");
      expect((await index.query(one, "added", 5))[0]?.path).toBe("b.py");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the whole repository again for a frame that names nothing, or a path not on disk", async () => {
    const { dir, repo } = oneRepository({ "a.ts": "export function first() {}\n" });
    try {
      const index = createSymbolIndex({ root: dir, languages: BUNDLED_LANGUAGES });
      const one = views(["repos/g/one"]);
      await index.query(one, "first", 5);
      writeFileSync(join(repo, "a.ts"), "export function second() {}\n");
      await index.changed("repos/g/one", []);
      expect((await index.query(one, "second", 5))[0]?.path).toBe("a.ts");
      // What Bun reports for an atomic write: the temporary name, gone by the time it is read.
      writeFileSync(join(repo, "a.ts"), "export function third() {}\n");
      await index.changed("repos/g/one", ["a.ts.tmp-1234"]);
      expect((await index.query(one, "third", 5))[0]?.path).toBe("a.ts");
      expect(await index.query(one, "second", 5)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops a repository whose read failed, and reads it again on the next question", async () => {
    const { dir, repo } = oneRepository({ "a.ts": "export function sound() {}\n" });
    try {
      const index = createSymbolIndex({ root: dir, languages: BUNDLED_LANGUAGES });
      const one = views(["repos/g/one"]);
      await index.query(one, "sound", 5);
      // Without its `.git` the listing fails, and so does the whole read the frame asked for.
      renameSync(join(repo, ".git"), join(repo, ".git-away"));
      await expect(index.changed("repos/g/one", [])).rejects.toThrow();
      renameSync(join(repo, ".git-away"), join(repo, ".git"));
      writeFileSync(join(repo, "a.ts"), "export function mended() {}\n");
      expect((await index.query(one, "mended", 5))[0]?.path).toBe("a.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads again what the change set says moved, with no frame at all", async () => {
    const { dir, repo } = oneRepository({ "a.ts": "export function early() {}\n" });
    try {
      const index = createSymbolIndex({ root: dir, languages: BUNDLED_LANGUAGES });
      const before = [{ path: "repos/g/one", files: [{ path: "a.ts", patch: "one" }] }];
      await index.query(before, "early", 5);
      writeFileSync(join(repo, "a.ts"), "export function late() {}\n");
      const after = [{ path: "repos/g/one", files: [{ path: "a.ts", patch: "two" }] }];
      expect((await index.query(after, "late", 5))[0]?.path).toBe("a.ts");
      expect(await index.query(after, "early", 5)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follows a diff-changed of the server's stream through GET /api/search/symbols", async () => {
    const { dir, repo } = oneRepository({ "a.ts": "export function streamedBefore() {}\n" });
    try {
      const config = await loadConfig({ root: dir });
      await createSession(config.dataDir, "live", { mode: "head" }, undefined);
      const events = createEventStream();
      const server = createApp({
        activity: createActivityLog(),
        config,
        events,
        review: createReviewService(config),
        ui: { read: async () => null },
      });
      expect((await server.request("/api/review")).status).toBe(200);
      const names = async (q: string) =>
        (
          (await (await server.request(`/api/search/symbols?q=${q}`)).json()) as SymbolSearch
        ).hits.map((hit) => hit.name);
      expect(await names("streamedbefore")).toEqual(["streamedBefore"]);

      writeFileSync(join(repo, "a.ts"), "export function streamedAfter() {}\n");
      events.emit("diff-changed", { type: "diff-changed", repo: "repos/g/one", files: ["a.ts"] });
      expect(await names("streamedafter")).toEqual(["streamedAfter"]);

      writeFileSync(join(repo, "a.ts"), "export function streamedLast() {}\n");
      events.emit("diff-changed", { type: "diff-changed", repo: "repos/g/one", files: [] });
      expect(await names("streamedlast")).toEqual(["streamedLast"]);
      expect(await names("streamedafter")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the bundled languages", () => {
  const SAMPLES: Record<string, [string, string, Record<string, string>]> = {
    typescript: [
      "s.ts",
      "export function alpha() {}\nclass Beta { gamma() {} }\ninterface Delta {}\n",
      { alpha: "function", Beta: "class", gamma: "method", Delta: "type" },
    ],
    tsx: [
      "s.tsx",
      "export function Panel() { return <div />; }\nconst row = () => <b />;\n",
      { Panel: "function", row: "function" },
    ],
    javascript: [
      "s.js",
      "function omega() {}\nclass Sigma { tau() {} }\nconst upsilon = function () {};\n",
      { omega: "function", Sigma: "class", tau: "method", upsilon: "function" },
    ],
    "c-sharp": [
      "s.cs",
      "namespace N { public class Kappa { public void Lambda() {} } interface IMu {} record Nu(int A); }\n",
      { Kappa: "class", Lambda: "method", IMu: "type", Nu: "class" },
    ],
    python: [
      "s.py",
      "def xi():\n  pass\nclass Omicron:\n  def pi(self):\n    pass\n",
      { xi: "function", Omicron: "class", pi: "function" },
    ],
    go: [
      "s.go",
      "package p\nfunc Rho() {}\ntype Tau struct{}\nfunc (t Tau) Phi() {}\n",
      { Rho: "function", Tau: "type", Phi: "method" },
    ],
    rust: [
      "s.rs",
      "fn chi() {}\nstruct Psi;\ntrait Zed {}\nimpl Psi { fn eta(&self) {} }\n",
      { chi: "function", Psi: "type", Zed: "type", eta: "function" },
    ],
    java: [
      "S.java",
      "class Theta { void iota() {} }\ninterface Kay {}\nenum Ell { A }\nrecord Em(int a) {}\n",
      { Theta: "class", iota: "method", Kay: "type", Ell: "type", Em: "class" },
    ],
  };

  it("has a query for every language that compiles and finds a definition of each kind it names", async () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(BUNDLED_LANGUAGES.map((one) => one.name).sort());
    const files = Object.fromEntries(Object.values(SAMPLES).map(([path, text]) => [path, text]));
    const { dir } = oneRepository(files);
    try {
      const index = createSymbolIndex({ root: dir, languages: BUNDLED_LANGUAGES });
      const one = views(["repos/g/one"]);
      for (const [language, [path, , expected]] of Object.entries(SAMPLES)) {
        for (const [name, kind] of Object.entries(expected)) {
          const hit = (await index.query(one, name, 20)).find(
            (one) => one.name === name && one.path === path,
          );
          expect(hit, `${language}: ${name}`).toMatchObject({ path, kind });
        }
      }
      expect(index.failures()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lets a language whose query will not compile fail alone, and says which", async () => {
    const { dir } = oneRepository({
      "a.ts": "export function stillHere() {}\n",
      "b.js": "function lost() {}\n",
    });
    try {
      const broken = BUNDLED_LANGUAGES.map((one) =>
        one.name === "javascript" ? { ...one, query: "(no_such_node) @function" } : one,
      );
      const index = createSymbolIndex({ root: dir, languages: broken });
      const one = views(["repos/g/one"]);
      expect((await index.query(one, "stillhere", 5))[0]?.path).toBe("a.ts");
      expect(await index.query(one, "lost", 5)).toEqual([]);
      expect(index.failures().map((one) => one.language)).toEqual(["javascript"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names a configured language that will not load in the answer of the route", async () => {
    const { dir } = oneRepository({ "a.ts": "export function routed() {}\n" });
    try {
      writeFileSync(
        join(dir, ".diffalanche", "config.json"),
        JSON.stringify({
          roots: ["repos"],
          depth: 2,
          grammars: {
            kotlin: { wasm: "missing.wasm", extensions: [".kt"], query: "(x) @function" },
          },
        }),
      );
      writeFileSync(join(dir, "repos", "g", "one", "c.kt"), "fun kappa() {}\n");
      const config = await loadConfig({ root: dir });
      await createSession(config.dataDir, "k", { mode: "head" }, undefined);
      const server = createApp({
        activity: createActivityLog(),
        config,
        events: createEventStream(),
        review: createReviewService(config),
        ui: { read: async () => null },
      });
      expect((await server.request("/api/review")).status).toBe(200);
      const result = (await (
        await server.request("/api/search/symbols?q=routed")
      ).json()) as SymbolSearch;
      expect(result.hits.map((hit) => hit.name)).toEqual(["routed"]);
      expect(result.failed.map((one) => one.language)).toEqual(["kotlin"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the time it takes", () => {
  it(`indexes 300 files in four languages inside ${SYMBOL_INDEX_BUDGET_MS} ms`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "diffalanche-symbols-300-"));
    try {
      const repo = join(dir, "repos", "g", "many");
      mkdirSync(repo, { recursive: true });
      const body = (n: number, kind: string) =>
        Array.from({ length: 12 }, (_, at) => {
          const name = `item${n}x${at}`;
          if (kind === "ts")
            return `export function ${name}(value: number): number {\n  return value + ${at};\n}\n`;
          if (kind === "py") return `def ${name}(value):\n    return value + ${at}\n`;
          if (kind === "go") return `func ${name}(value int) int {\n\treturn value + ${at}\n}\n`;
          return `public sealed class ${name} {\n  public int Run(int value) { return value + ${at}; }\n}\n`;
        }).join("\n");
      const kinds = ["ts", "py", "go", "cs"];
      for (let n = 0; n < 300; n += 1) {
        const kind = kinds[n % 4] as string;
        const head = kind === "go" ? "package many\n\n" : "";
        writeFileSync(join(repo, `f${n}.${kind}`), head + body(n, kind));
      }
      git(repo, "init", "-q", "-b", "main");
      const index = createSymbolIndex({ root: dir, languages: BUNDLED_LANGUAGES });
      const started = performance.now();
      const found = await index.query(views(["repos/g/many"]), "item299x11", 1);
      const took = performance.now() - started;
      expect(found[0]?.path).toBe("f299.cs");
      expect(took).toBeLessThan(SYMBOL_INDEX_BUDGET_MS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
