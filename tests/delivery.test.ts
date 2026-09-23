/** `src/core/ml/embed/delivery.ts`: the release's names, the download with its checksum and its
 * refusals, and the copy out of a binary, against a server of the test's own (09-ml.md). */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.ts";
import type { Asset } from "../src/core/ml/embed/delivery.ts";
import { assets, deliverFrom, provide, releaseBase } from "../src/core/ml/embed/delivery.ts";
import { ModelError } from "../src/core/ml/embed/errors.ts";
import {
  currentPlatform,
  EMBEDDING_MODEL,
  EMBEDDING_PLATFORMS,
} from "../src/core/ml/embed/model.ts";
import { openThreadedEmbedder, prepare } from "../src/core/ml/embed/open.ts";
import type { UiAssets } from "../src/server/assets.ts";

function asset(name: string, content: Buffer, within = ""): Asset {
  return {
    asset: `release-${name}`,
    file: {
      name,
      path: name,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    },
    within,
  };
}

/** A shell script standing in for the binary a write-out starts; POSIX only. */
function stand(dir: string, script: string): string {
  const path = join(dir, "binary.sh");
  writeFileSync(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return path;
}

const ONE = Buffer.alloc(40_000, 7);
const TWO = Buffer.from("tokenizer\n");

describe("the names of the release", () => {
  it("names every pin and every platform apart", () => {
    const names = assets(EMBEDDING_MODEL, "darwin-arm64").map((one) => one.asset);
    expect(names).toEqual([
      "multilingual-e5-small-761b726dd34f-model_quantized.onnx",
      "multilingual-e5-small-761b726dd34f-tokenizer.json",
      "multilingual-e5-small-761b726dd34f-tokenizer_config.json",
      "onnxruntime-node-1.30.0-darwin-arm64-onnxruntime_binding.node",
      "onnxruntime-node-1.30.0-darwin-arm64-libonnxruntime.1.dylib",
    ]);
    expect(assets(EMBEDDING_MODEL, null)).toHaveLength(3);
    expect(assets(EMBEDDING_MODEL, "darwin-x64")).toHaveLength(3);
    // The runtime's files keep a directory of their version and platform under the model's.
    expect(assets(EMBEDDING_MODEL, "darwin-arm64").map((one) => one.within)).toEqual([
      "",
      "",
      "",
      "onnxruntime-node-1.30.0-darwin-arm64",
      "onnxruntime-node-1.30.0-darwin-arm64",
    ]);
  });

  it("downloads from this version's release unless a mirror is named", () => {
    expect(releaseBase("0.2.0", {})).toBe(
      "https://github.com/Velklish/diffalanche/releases/download/v0.2.0",
    );
    expect(releaseBase("0.2.0", { DIFFALANCHE_ASSETS_URL: "http://127.0.0.1:9/x" })).toBe(
      "http://127.0.0.1:9/x",
    );
  });
});

describe("a download from the release", () => {
  let server: Server;
  let base: string;
  let served: Record<string, Buffer>;
  let requests: string[];
  let dir: string;
  // Each body in four parts a little apart, so two downloads of one file overlap.
  let slow: boolean;

  const send = async (response: ServerResponse, body: Buffer) => {
    response.writeHead(200, { "content-length": body.length });
    if (!slow) return void response.end(body);
    const part = Math.ceil(body.length / 4);
    for (let at = 0; at < body.length; at += part) {
      response.write(body.subarray(at, at + part));
      await new Promise((done) => setTimeout(done, 20));
    }
    response.end();
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const name = (request.url ?? "").slice(1);
      requests.push(name);
      const body = served[name];
      if (body === undefined) {
        response.writeHead(404).end();
        return;
      }
      void send(response, body);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  beforeEach(() => {
    served = { "release-model.onnx": ONE, "release-tokenizer.json": TWO };
    requests = [];
    slow = false;
    dir = mkdtempSync(join(tmpdir(), "diffalanche-delivery-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("puts every file in place once, with its progress, and leaves the ones already there", async () => {
    const wanted = [asset("model.onnx", ONE), asset("tokenizer.json", TWO)];
    let progress = "";
    await provide(wanted, dir, { from: "release", base }, (text) => {
      progress += text;
    });
    expect(readFileSync(join(dir, "model.onnx")).equals(ONE)).toBe(true);
    expect(readFileSync(join(dir, "tokenizer.json")).equals(TWO)).toBe(true);
    expect(progress).toBe(
      "downloading release-model.onnx, 40 kB: 25% 50% 75% 100%\n" +
        "downloading release-tokenizer.json, 1 kB: 25% 50% 75% 100%\n",
    );
    await provide(wanted, dir, { from: "release", base }, () => {});
    expect(requests).toEqual(["release-model.onnx", "release-tokenizer.json"]);
  });

  it("lets two preparations of one directory run at once, and keeps one whole file", async () => {
    slow = true;
    const wanted = [asset("model.onnx", ONE), asset("binding.node", TWO, "runtime-1-test")];
    served["release-binding.node"] = TWO;
    const release = { from: "release", base } as const;
    await Promise.all([
      provide(wanted, dir, release, () => {}),
      provide(wanted, dir, release, () => {}),
    ]);
    expect(readFileSync(join(dir, "model.onnx")).equals(ONE)).toBe(true);
    expect(readFileSync(join(dir, "runtime-1-test", "binding.node")).equals(TWO)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(["model.onnx", "runtime-1-test"]);
    expect(readdirSync(join(dir, "runtime-1-test"))).toEqual(["binding.node"]);
  });

  it("takes away a partial file nobody writes: by its process on this host, by its age on another", async () => {
    const host = hostname().replace(/[^A-Za-z0-9.-]/g, "_") || "host";
    const ended = spawnSync(process.execPath, ["-e", ""]).pid;
    const mine = `model.onnx.partial-${host}-${process.pid}-0c1d`;
    // Another host's process id says nothing here: only a file left alone for ten minutes goes.
    const elsewhere = `model.onnx.partial-other-box-${ended}-0e1f`;
    const abandoned = `model.onnx.partial-other-box-${process.pid}-0a2b`;
    writeFileSync(join(dir, `model.onnx.partial-${host}-${ended}-0a1b`), "half");
    writeFileSync(join(dir, mine), "in progress");
    writeFileSync(join(dir, elsewhere), "in progress on another host");
    writeFileSync(join(dir, abandoned), "left on another host");
    const eleven = new Date(Date.now() - 11 * 60 * 1000);
    utimesSync(join(dir, abandoned), eleven, eleven);
    await provide([asset("model.onnx", ONE)], dir, { from: "release", base }, () => {});
    expect(readdirSync(dir).sort()).toEqual(["model.onnx", elsewhere, mine].sort());
  });

  it("refuses in one line a file that cannot take its name", async () => {
    mkdirSync(join(dir, "model.onnx", "in-the-way"), { recursive: true });
    const refusal = provide([asset("model.onnx", ONE)], dir, { from: "release", base }, () => {});
    await expect(refusal).rejects.toThrow(ModelError);
    await expect(refusal).rejects.toThrow(`${join(dir, "model.onnx")} could not take its name: `);
    expect(readdirSync(dir)).toEqual(["model.onnx"]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "says a write the disk refused apart from a network that failed",
    async () => {
      chmodSync(dir, 0o500);
      try {
        const refusal = provide(
          [asset("model.onnx", ONE)],
          dir,
          { from: "release", base },
          () => {},
        );
        await expect(refusal).rejects.toThrow(ModelError);
        await expect(refusal).rejects.toThrow(
          new RegExp(
            `^model\\.onnx could not be written to ${dir}: EACCES.*\\. Nothing was left behind; ` +
              "with room on the disk and the right to write there, " +
              "`diffalanche model pull --embedding` puts it in place$",
          ),
        );
      } finally {
        chmodSync(dir, 0o700);
      }
      expect(readdirSync(dir)).toEqual([]);
    },
  );

  it("refuses a file whose checksum is not the pinned one, and writes nothing", async () => {
    const wrong = Buffer.alloc(ONE.length, 8);
    served["release-model.onnx"] = wrong;
    const got = createHash("sha256").update(wrong).digest("hex");
    const refusal = provide([asset("model.onnx", ONE)], dir, { from: "release", base }, () => {});
    await expect(refusal).rejects.toThrow(ModelError);
    await expect(refusal).rejects.toThrow(
      `${base}/release-model.onnx has sha256 ${got}, and this build pins ` +
        `${asset("model.onnx", ONE).file.sha256}: nothing was written`,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("says which file could not be downloaded, from where, and what fetches it later", async () => {
    const offline = "http://127.0.0.1:9";
    const refusal = provide(
      [asset("model.onnx", ONE)],
      dir,
      { from: "release", base: offline },
      () => {},
    );
    await expect(refusal).rejects.toThrow(ModelError);
    await expect(refusal).rejects.toThrow(
      new RegExp(
        `^model\\.onnx is not in ${dir} and could not be downloaded from ${offline}/release-model\\.onnx: .+\\. ` +
          "Nothing was written; `diffalanche model pull --embedding` fetches it once there is a network$",
      ),
    );
    const missing = provide([asset("gone.bin", TWO)], dir, { from: "release", base }, () => {});
    await expect(missing).rejects.toThrow(/release-gone\.bin: HTTP 404/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes a binary's own files out of it, checked the same way", async () => {
    const carried = mkdtempSync(join(tmpdir(), "diffalanche-carried-"));
    // As the process a binary starts to write them out: here, not in a child of the runner.
    vi.stubEnv("DIFFALANCHE_WRITE_OUT", "1");
    try {
      writeFileSync(join(carried, "one"), ONE);
      writeFileSync(join(carried, "two"), Buffer.from("not the tokenizer"));
      const files = {
        "release-model.onnx": join(carried, "one"),
        "release-tokenizer.json": join(carried, "two"),
      };
      await provide([asset("model.onnx", ONE)], dir, { from: "binary", files }, () => {});
      expect(readFileSync(join(dir, "model.onnx")).equals(ONE)).toBe(true);
      await expect(
        provide([asset("tokenizer.json", TWO)], dir, { from: "binary", files }, () => {}),
      ).rejects.toThrow(/has sha256 .*: nothing was written/);
      expect(existsSync(join(dir, "tokenizer.json"))).toBe(false);
      await expect(
        provide([asset("absent.bin", TWO)], dir, { from: "binary", files }, () => {}),
      ).rejects.toThrow(`this binary does not carry release-absent.bin, which ${dir} needs`);
    } finally {
      vi.unstubAllEnvs();
      rmSync(carried, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "has a binary write its files out in a process of its own, and says why one could not",
    async () => {
      const carried = mkdtempSync(join(tmpdir(), "diffalanche-carried-"));
      const execPath = process.execPath;
      try {
        writeFileSync(join(carried, "one"), ONE);
        const from = {
          from: "binary",
          files: { "release-model.onnx": join(carried, "one") },
        } as const;
        const wanted = [asset("model.onnx", ONE)];
        // The child is asked for `model pull --embedding`, told to write, and does.
        process.execPath = stand(
          carried,
          `[ "$*" = "model pull --embedding" ] && [ "$DIFFALANCHE_WRITE_OUT" = 1 ] || exit 9\n` +
            `echo "writing out" >&2\ncp "${join(carried, "one")}" "${join(dir, "model.onnx")}"`,
        );
        let progress = "";
        await provide(wanted, dir, from, (text) => {
          progress += text;
        });
        expect(readFileSync(join(dir, "model.onnx")).equals(ONE)).toBe(true);
        expect(progress).toBe("writing out\n");
        rmSync(join(dir, "model.onnx"));

        process.execPath = stand(carried, 'echo "no space left" >&2\nexit 3');
        await expect(provide(wanted, dir, from, () => {})).rejects.toThrow(
          new ModelError("the model could not be written out of the binary: no space left"),
        );
        process.execPath = stand(carried, "exit 4");
        await expect(provide(wanted, dir, from, () => {})).rejects.toThrow(
          "the model could not be written out of the binary: exit code 4",
        );
        process.execPath = join(carried, "not-there");
        const refusal = provide(wanted, dir, from, () => {});
        await expect(refusal).rejects.toThrow(ModelError);
        await expect(refusal).rejects.toThrow(
          /^the model could not be written out of the binary: .*ENOENT/,
        );
        expect(readdirSync(dir)).toEqual([]);
      } finally {
        process.execPath = execPath;
        rmSync(carried, { recursive: true, force: true });
      }
    },
  );
});

describe("the server's door to the model", () => {
  let server: Server;
  let base: string;
  let held: ServerResponse[];
  let dir: string;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      held.push(response);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
  });

  beforeEach(() => {
    held = [];
    dir = mkdtempSync(join(tmpdir(), "diffalanche-door-"));
    deliverFrom({ from: "release", base });
  });

  afterEach(() => {
    deliverFrom({ from: "sources" });
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!EMBEDDING_PLATFORMS.includes(currentPlatform()))(
    "refuses a request while the files arrive, then says how that ended",
    async () => {
      const first = await openThreadedEmbedder(dir).catch((error: unknown) => error);
      expect(first).toBeInstanceOf(ModelError);
      expect((first as Error).message).toBe(
        `the embedding model is being put in place in ${dir}: suggestions follow once it is there`,
      );
      // The download is still waiting on the server when the request has its answer.
      await vi.waitFor(() => expect(held).toHaveLength(1));
      held[0]?.writeHead(404).end();
      await prepare(dir).catch(() => {});

      const second = await openThreadedEmbedder(dir).catch((error: unknown) => error);
      expect(second).toBeInstanceOf(ModelError);
      expect((second as Error).message).toMatch(
        /^model_quantized\.onnx is not in .* and could not be downloaded from .*: HTTP 404\./,
      );
      // Told once; the next request starts it again.
      const third = await openThreadedEmbedder(dir).catch((error: unknown) => error);
      expect((third as Error).message).toMatch(/is being put in place/);
      await vi.waitFor(() => expect(held).toHaveLength(2));
      held[1]?.writeHead(404).end();
      await prepare(dir).catch(() => {});
    },
  );
});

describe("model pull", () => {
  it("needs --embedding while the generative model is not built", async () => {
    let err = "";
    const noUi: UiAssets = { read: async () => null };
    const output = {
      out: () => {},
      err: (text: string) => {
        err += text;
      },
    };
    expect(await run(["model", "pull"], noUi, output)).toBe(1);
    expect(err).toBe(
      "diffalanche: model pull needs --embedding: the generative model comes in Phase 4\n",
    );
  });
});
