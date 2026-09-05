import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, DEFAULT_DEPTH, DEFAULT_PORT, loadConfig } from "../src/core/config/index.ts";
import { dataDirOf, StorageError } from "../src/core/storage/index.ts";

let root: string;
let savedGlobal: string | undefined;
let savedSystem: string | undefined;

/** Writes `config.json` into the data directory of the root. */
function writeConfig(value: unknown): void {
  const dataDir = dataDirOf(root);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath(dataDir), `${JSON.stringify(value, null, 2)}\n`);
}

/** Points git at a configuration of the test's own, so the developer's is out of the way. */
function gitIdentity(name: string | null): void {
  if (name === null) {
    process.env.GIT_CONFIG_GLOBAL = devNull;
    return;
  }
  const file = join(root, "gitconfig");
  writeFileSync(file, `[user]\n\tname = ${name}\n`);
  process.env.GIT_CONFIG_GLOBAL = file;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "diffalanche-config-"));
  savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  savedSystem = process.env.GIT_CONFIG_SYSTEM;
  process.env.GIT_CONFIG_SYSTEM = devNull;
  gitIdentity(null);
});

afterEach(() => {
  process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  process.env.GIT_CONFIG_SYSTEM = savedSystem;
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
  rmSync(root, { recursive: true, force: true });
});

describe("defaults", () => {
  it("needs no config file", async () => {
    const config = await loadConfig({}, root);
    expect(config).toMatchObject({
      root,
      dataDir: join(root, ".diffalanche"),
      roots: [root],
      depth: DEFAULT_DEPTH,
      exclude: [],
      port: DEFAULT_PORT,
      lsp: {},
    });
  });

  it("takes every field of a full config file", async () => {
    writeConfig({
      roots: ["repos"],
      depth: 3,
      exclude: ["**/*.lock"],
      user: "kim.p",
      port: 5100,
      lsp: { typescript: ["typescript-language-server", "--stdio"] },
    });

    const config = await loadConfig({}, root);
    expect(config).toMatchObject({
      roots: [join(root, "repos")],
      depth: 3,
      exclude: ["**/*.lock"],
      user: "kim.p",
      port: 5100,
      lsp: { typescript: ["typescript-language-server", "--stdio"] },
    });
  });
});

describe("paths", () => {
  it("resolves roots against the root and --data-dir against the current directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "diffalanche-cwd-"));
    try {
      mkdirSync(join(cwd, "elsewhere"), { recursive: true });
      writeFileSync(
        join(cwd, "elsewhere", "config.json"),
        JSON.stringify({ roots: ["repos", "vendor"], user: "kim.p" }),
      );

      const config = await loadConfig({ root, dataDir: "elsewhere" }, cwd);
      expect(config.dataDir).toBe(join(cwd, "elsewhere"));
      expect(config.root).toBe(root);
      expect(config.roots).toEqual([join(root, "repos"), join(root, "vendor")]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("takes --root relative to the current directory", async () => {
    mkdirSync(join(root, "nested"));
    const config = await loadConfig({ root: "nested" }, root);
    expect(config.root).toBe(resolve(root, "nested"));
    expect(config.dataDir).toBe(join(root, "nested", ".diffalanche"));
  });
});

describe("overrides", () => {
  it("puts --port above the file", async () => {
    writeConfig({ port: 5100, user: "kim.p" });
    expect((await loadConfig({ port: 5000 }, root)).port).toBe(5000);
  });

  it("checks --port itself", async () => {
    const error = await loadConfig({ port: 70_000 }, root).catch((caught: unknown) => caught);
    expect((error as StorageError).field).toBe("--port");
    expect((error as StorageError).message).toContain("between 1 and 65535");
  });

  it("still checks the file's port when --port replaces it", async () => {
    writeConfig({ port: 0, user: "kim.p" });
    await expect(loadConfig({ port: 5000 }, root)).rejects.toThrow(/config\.json: port:/);
  });
});

describe("errors", () => {
  it("names the file and the field of a wrong type", async () => {
    writeConfig({ port: "x", user: "kim.p" });
    const error = await loadConfig({}, root).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).file).toBe(configPath(dataDirOf(root)));
    expect((error as StorageError).field).toBe("port");
    expect((error as StorageError).message).toContain("between 1 and 65535");
  });

  it("names the language of a broken lsp entry", async () => {
    writeConfig({ user: "kim.p", lsp: { csharp: "csharp-ls" } });
    await expect(loadConfig({}, root)).rejects.toThrow(/lsp\.csharp: expected an array/);
  });

  it("refuses a depth that is not a whole number of levels", async () => {
    writeConfig({ user: "kim.p", depth: -1 });
    await expect(loadConfig({}, root)).rejects.toThrow(/depth: expected a whole number/);
  });
});

describe("user fallback", () => {
  it("takes git's user.name when the file has none", async () => {
    gitIdentity("fixture-user");
    expect((await loadConfig({}, root)).user).toBe("fixture-user");
  });

  it("falls back to the operating system user when git has no name", async () => {
    gitIdentity(null);
    expect((await loadConfig({}, root)).user).toBe(userInfo().username);
  });

  it("prefers the file over both", async () => {
    gitIdentity("fixture-user");
    writeConfig({ user: "kim.p" });
    expect((await loadConfig({}, root)).user).toBe("kim.p");
  });
});
