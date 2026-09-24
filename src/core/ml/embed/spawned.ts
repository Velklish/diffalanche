/** An `Embedder` whose model runs in `child.ts`, a process of its own: the model's memory is that
 * process's and not the server's or a command's (09-ml.md, "In a process of its own"). */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { CHILD, type Question, type Reply, type Request, type Start } from "./child.ts";
import { delivery } from "./delivery.ts";
import type { Embedder } from "./embedder.ts";
import { ModelError } from "./errors.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "./model.ts";

export type SpawnedEmbedder = Embedder & {
  /** The process's id, for a harness that watches it end. */
  pid: number | undefined;
  /** Ends the process; a call still waiting is refused. */
  close: () => Promise<void>;
  /** Settles when the process has ended, however it ended. */
  exited: Promise<void>;
  /** The process's peak resident size so far: its `maxRSS`, in the unit its runtime reports. */
  peak: () => Promise<number>;
};

type Pending = { resolve: (reply: Reply) => void; reject: (error: Error) => void };

/** A binary carries no script to hand a runtime, so it runs itself and `CHILD` says which part;
 * every other channel runs its child file with this runtime (09-ml.md, "In a process of its own"). */
function childArguments(script: URL | undefined): string[] {
  if (script !== undefined) return [fileURLToPath(script)];
  if (delivery().from === "binary") return [];
  return [fileURLToPath(new URL("./child-entry.ts", import.meta.url))];
}

function vectorOf(base64: string): Float32Array {
  const bytes = Buffer.from(base64, "base64");
  const vector = new Float32Array(bytes.length / 4);
  new Uint8Array(vector.buffer).set(bytes);
  return vector;
}

function parsed(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The line a runtime writes for an error that ended the process, Node's coded form included
 * (`Error [ERR_MODULE_NOT_FOUND]: …`). */
function errorLine(said: string): string | undefined {
  return /^(?:\w*Error|error)(?: \[\w+\])?: .+$/m.exec(said)?.[0];
}

/** `binding` is the runtime's binding in the cache on the two channels, `undefined` from sources;
 * `script` is the child's module, which a test replaces with one that fails to load. */
export function startSpawnedEmbedder(
  location: string,
  options: { binding?: string | undefined; script?: URL } = {},
): Promise<SpawnedEmbedder> {
  const child = spawn(process.execPath, childArguments(options.script), {
    // Its standard error is read for a line, not shown: Bun colours it under FORCE_COLOR.
    env: { ...process.env, [CHILD]: "1", FORCE_COLOR: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, Pending>();
  let next = 1;
  let ready = false;
  let gone: ModelError | null = null;
  let said = "";
  const exited = new Promise<void>((done) => child.once("close", () => done()));
  // Held while it loads and while a call waits, let go when idle, so a command that never closes
  // it still exits; a pipe without `unref` (Bun's standard input) holds nothing (09-ml.md).
  const handles = [child, child.stdin, child.stdout, child.stderr] as {
    ref?: () => void;
    unref?: () => void;
  }[];
  const hold = () => {
    for (const one of handles) one.ref?.();
  };
  const idle = () => {
    for (const one of handles) one.unref?.();
  };
  const ask = (question: Question): Promise<Reply> => {
    if (gone !== null) return Promise.reject(gone);
    const id = next;
    next += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      hold();
      child.stdin.write(`${JSON.stringify({ ...question, id } satisfies Request)}\n`);
    });
  };

  return new Promise((resolveStart, rejectStart) => {
    const end = (error: ModelError) => {
      gone ??= error;
      for (const waiting of pending.values()) waiting.reject(gone);
      pending.clear();
      rejectStart(gone);
    };
    // A write to a process that has ended fails with EPIPE; its end is told by `close`, below.
    child.stdin.on("error", () => {});
    child.stderr.on("data", (chunk: Buffer) => {
      said = (said + chunk.toString()).slice(-4096);
    });
    child.on("error", (error) => {
      end(new ModelError(`the embedding process could not be started: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
      const line = errorLine(said);
      end(
        new ModelError(
          ready
            ? `the embedding process has ended (${how})${line === undefined ? "" : `: ${line}`}`
            : `the embedding runtime could not be loaded: ${line ?? how}`,
        ),
      );
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const read = parsed(line);
      // A primitive passes a parse and would throw below, in a listener: the server would end.
      if (typeof read !== "object" || read === null) {
        end(
          new ModelError(
            `the embedding process wrote what is not an answer: ${line.slice(0, 200)}`,
          ),
        );
        child.kill();
        return;
      }
      const reply = read as Reply;
      if ("ready" in reply) {
        ready = true;
        idle();
        resolveStart(spawned);
        return;
      }
      if ("error" in reply && reply.id === null) {
        end(new ModelError(reply.error));
        child.stdin.end();
        return;
      }
      const waiting = pending.get(reply.id as number);
      pending.delete(reply.id as number);
      if (pending.size === 0) idle();
      if ("error" in reply) waiting?.reject(new Error(reply.error));
      else waiting?.resolve(reply);
    });

    child.stdin.write(
      `${JSON.stringify({ location, binding: options.binding } satisfies Start)}\n`,
    );

    const spawned: SpawnedEmbedder = {
      model: EMBEDDING_MODEL,
      identity: embeddingIdentity(EMBEDDING_MODEL),
      embed: async (texts) => {
        const reply = await ask({ texts });
        return (reply as { vectors: string[] }).vectors.map(vectorOf);
      },
      pid: child.pid,
      peak: async () => ((await ask({ peak: true })) as { peak: number }).peak,
      exited,
      close: async () => {
        if (gone !== null) return;
        hold();
        child.stdin.end();
        await exited;
      },
    };
  });
}
