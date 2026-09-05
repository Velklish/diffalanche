import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configPath,
  DEFAULT_DEPTH,
  DEFAULT_PORT,
  loadConfig,
  userConfigPath,
} from "../src/core/config/index.ts";
import { dataDirOf, StorageError } from "../src/core/storage/index.ts";

let root: string;
let savedGlobal: string | undefined;
let savedSystem: string | undefined;
let savedConfigHome: string | undefined;
let savedDataDirEnv: string | undefined;
/** An empty user configuration directory, so the developer's own stays out of the way. */
let configHome: string;

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
  configHome = mkdtempSync(join(tmpdir(), "diffalanche-config-home-"));
  savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  savedSystem = process.env.GIT_CONFIG_SYSTEM;
  savedConfigHome = process.env.XDG_CONFIG_HOME;
  savedDataDirEnv = process.env.DIFFALANCHE_DATA_DIR;
  process.env.GIT_CONFIG_SYSTEM = devNull;
  process.env.XDG_CONFIG_HOME = configHome;
  delete process.env.DIFFALANCHE_DATA_DIR;
  gitIdentity(null);
});

afterEach(() => {
  process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  process.env.GIT_CONFIG_SYSTEM = savedSystem;
  process.env.XDG_CONFIG_HOME = savedConfigHome;
  process.env.DIFFALANCHE_DATA_DIR = savedDataDirEnv;
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  if (savedSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  if (savedDataDirEnv === undefined) delete process.env.DIFFALANCHE_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
  rmSync(configHome, { recursive: true, force: true });
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

describe("data directory", () => {
  /** Writes the user's `diffalanche/config.json` into the test's own configuration directory. */
  function writeUserConfig(value: unknown): void {
    const file = userConfigPath(configHome);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`);
  }

  it("takes DIFFALANCHE_DATA_DIR relative to the root", async () => {
    const env = { DIFFALANCHE_DATA_DIR: ".agents/diffalanche" };
    const config = await loadConfig({}, root, { env, configHome });
    expect(config.dataDir).toBe(join(root, ".agents", "diffalanche"));
  });

  it("takes the dataDir of the user config relative to the root", async () => {
    writeUserConfig({ dataDir: ".agents/diffalanche" });
    const config = await loadConfig({}, root, { env: {}, configHome });
    expect(config.dataDir).toBe(join(root, ".agents", "diffalanche"));
  });

  it("finds the user config through XDG_CONFIG_HOME when no directory is given", async () => {
    writeUserConfig({ dataDir: "state" });
    const config = await loadConfig({}, root);
    expect(config.dataDir).toBe(join(root, "state"));
  });

  it("puts --data-dir above the variable", async () => {
    const env = { DIFFALANCHE_DATA_DIR: ".agents/diffalanche" };
    const config = await loadConfig({ dataDir: "elsewhere" }, root, { env, configHome });
    expect(config.dataDir).toBe(join(root, "elsewhere"));
  });

  it("puts the variable above the user config", async () => {
    writeUserConfig({ dataDir: "from-user-config" });
    const env = { DIFFALANCHE_DATA_DIR: "from-env" };
    const config = await loadConfig({}, root, { env, configHome });
    expect(config.dataDir).toBe(join(root, "from-env"));
  });

  it("treats an empty variable as unset", async () => {
    writeUserConfig({ dataDir: "from-user-config" });
    const env = { DIFFALANCHE_DATA_DIR: "" };
    const config = await loadConfig({}, root, { env, configHome });
    expect(config.dataDir).toBe(join(root, "from-user-config"));
  });

  it("refuses a dataDir in the user config that is not a string, naming the file", async () => {
    writeUserConfig({ dataDir: 7 });
    const attempt = loadConfig({}, root, { env: {}, configHome });
    await expect(attempt).rejects.toThrow(userConfigPath(configHome));
    await expect(attempt).rejects.toThrow("dataDir");
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
