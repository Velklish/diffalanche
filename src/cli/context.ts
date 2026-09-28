/** What every command is handed: the configuration with the flags folded in, the session, and
 * where to write; the first two are read lazily (06-cli.md, "How a command is defined"). */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "../core/config/index.ts";
import { loadConfig } from "../core/config/index.ts";
import { resolveSessionName } from "../core/domain/index.ts";
import type { UiAssets } from "../server/assets.ts";
import type { Arguments } from "./args.ts";
import { count, text } from "./args.ts";
import { UsageError } from "./errors.ts";
import type { Output } from "./output.ts";

/** A path a flag names: `--root` must exist, `--data-dir` may not yet, and a file in either
 * place is a mistake (06-cli.md, "Global flags"). */
async function assertDirectory(flag: string, value: string, mustExist: boolean): Promise<void> {
  const path = resolve(process.cwd(), value);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && !mustExist) return;
    if (code === "ENOENT") throw new UsageError(`--${flag}: no such directory: ${path}`);
    if (code === "ENOTDIR") throw new UsageError(`--${flag}: ${path} is not a directory`);
    if (code === "EACCES") throw new UsageError(`--${flag}: ${path} cannot be read`);
    throw error;
  }
  if (!info.isDirectory()) throw new UsageError(`--${flag}: ${path} is not a directory`);
}

export type Context = {
  io: Output;
  /** The built UI `serve` hands to the server; the other commands never look at it. */
  ui: UiAssets;
  config: () => Promise<Config>;
  session: () => Promise<string>;
};

/** Builds the context; `--port` is read here although only `serve` offers it, because the port
 * is configuration and `loadConfig` is the one place that checks it. */
export function createContext(args: Arguments, io: Output, ui: UiAssets): Context {
  let config: Promise<Config> | null = null;
  let session: Promise<string> | null = null;

  const readConfig = (): Promise<Config> => {
    const root = text(args, "root");
    const dataDir = text(args, "data-dir");
    const port = count(args, "port");
    config ??= (async () => {
      if (root !== undefined) await assertDirectory("root", root, true);
      if (dataDir !== undefined) await assertDirectory("data-dir", dataDir, false);
      return loadConfig({
        ...(root === undefined ? {} : { root }),
        ...(dataDir === undefined ? {} : { dataDir }),
        ...(port === undefined ? {} : { port }),
      });
    })();
    return config;
  };

  return {
    io,
    ui,
    config: readConfig,
    session: () => {
      session ??= readConfig().then((resolved) =>
        resolveSessionName(resolved.dataDir, text(args, "review")),
      );
      return session;
    },
  };
}
