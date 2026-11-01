/** Listen refusals do not depend on the host's privileged-port policy (07-server.md). */
import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import { loadConfig } from "../src/core/config/index.ts";
import * as watcher from "../src/core/watcher/index.ts";
import * as runtime from "../src/server/runtime.ts";
import { startReviewServer } from "../src/server/serve.ts";
import { makeRoot } from "./helpers/fixture-root.ts";

vi.mock("../src/server/runtime.ts", { spy: true });
vi.mock("../src/core/watcher/index.ts", async (original) => {
  const actual = await original<typeof watcher>();
  return {
    ...actual,
    startWatcher: vi.fn(async (...args: Parameters<typeof actual.startWatcher>) => {
      const running = await actual.startWatcher(...args);
      vi.spyOn(running, "close");
      return running;
    }),
  };
});

describe("listen permission reporting", () => {
  let root: string;
  beforeEach(() => {
    root = makeRoot();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("reports EACCES in one line with exit 1 and closes its watcher", async () => {
    vi.mocked(runtime.startServer).mockRejectedValueOnce(
      Object.assign(new Error("listen EACCES"), { code: "EACCES" }),
    );
    let out = "";
    let err = "";
    const code = await run(
      ["serve", "--root", root, "--port", "1"],
      { read: async () => null },
      {
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
      },
    );
    const running = await vi.mocked(watcher.startWatcher).mock.results[0]?.value;
    try {
      expect(code).toBe(1);
      expect(out).toBe("");
      expect(err).toBe(
        "diffalanche: port 1 is not allowed for this user: run with --port <n> above 1023\n",
      );
      expect(running?.close).toHaveBeenCalledTimes(1);
    } finally {
      await running?.close();
    }
  });

  it.each([false, true])(
    "closes an allowed server and watcher after fixture failure=%s",
    async (fails) => {
      const config = { ...(await loadConfig({ root })), port: 0 };
      const server = await startReviewServer({ config });
      const running = await vi.mocked(watcher.startWatcher).mock.results[0]?.value;
      const failure = new Error("fixture failed after a successful bind");
      const exercise = async () => {
        try {
          expect(server.port).toBeGreaterThan(0);
          expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
          if (fails) throw failure;
        } finally {
          await server.close();
        }
      };
      if (fails) await expect(exercise()).rejects.toBe(failure);
      else await exercise();
      expect(running?.close).toHaveBeenCalledTimes(1);
      const rebound = createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          rebound.once("error", reject);
          rebound.listen(server.port, "127.0.0.1", resolve);
        });
        expect(rebound.listening).toBe(true);
      } finally {
        await new Promise<void>((resolve, reject) => {
          rebound.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  );
});

it("documents measured port policy rather than inferring it from a non-root identity", () => {
  const reference = readFileSync(
    new URL("../docs/reference/07-server.md", import.meta.url),
    "utf8",
  );
  expect(reference).toContain(
    "A non-root identity does not establish whether a privileged port is allowed.",
  );
});
