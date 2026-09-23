/** An `Embedder` whose model runs in `worker.ts` on a thread of its own, for the server: a run
 * there holds that thread and not the event loop (DA-34.1 measured why, 09-ml.md). */
import { Worker } from "node:worker_threads";
import type { Embedder } from "./embedder.ts";
import { ModelError } from "./errors.ts";
import { EMBEDDING_MODEL, embeddingIdentity } from "./model.ts";
import type { Reply, Request } from "./worker.ts";

export type ThreadedEmbedder = Embedder & {
  /** Ends the thread; a call still waiting is refused. */
  close: () => Promise<void>;
  /** Settles when the thread has ended, however it ended. */
  exited: Promise<void>;
};

type Pending = { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void };

/** `script` is the thread's module; a test hands one that fails to load. */
export function startThreadedEmbedder(
  location: string,
  script: URL = new URL("./worker.ts", import.meta.url),
): Promise<ThreadedEmbedder> {
  const worker = new Worker(script, { workerData: { location } });
  const pending = new Map<number, Pending>();
  let next = 1;
  let gone: Error | null = null;
  const send = (request: Request) => worker.postMessage(request);
  const exited = new Promise<void>((done) => worker.once("exit", () => done()));
  // A thread is held while it loads and while a call waits, and let go when idle: one only
  // waiting for work keeps no process alive (09-ml.md, "In the server").
  const idle = () => worker.unref();

  return new Promise((resolveStart, rejectStart) => {
    // A thread that throws — its module or the runtime failing to load — is an answer, not a
    // fault: without a listener the error would take the whole server down (07-server.md).
    worker.on("error", (error) => {
      gone = new ModelError(`the embedding runtime could not be loaded: ${error.message}`);
      for (const waiting of pending.values()) waiting.reject(gone);
      pending.clear();
      rejectStart(gone);
    });
    worker.on("message", (reply: Reply) => {
      if ("ready" in reply) {
        idle();
        resolveStart(threaded);
        return;
      }
      if ("error" in reply && reply.id === null) {
        rejectStart(new ModelError(`the embedding model could not be loaded: ${reply.error}`));
        send({ close: true });
        return;
      }
      const waiting = pending.get(reply.id as number);
      pending.delete(reply.id as number);
      if (pending.size === 0) idle();
      if ("error" in reply) waiting?.reject(new Error(reply.error));
      else waiting?.resolve(reply.vectors);
    });
    worker.on("exit", (code) => {
      gone ??= new Error(`the embedding thread has ended (exit code ${code})`);
      for (const waiting of pending.values()) waiting.reject(gone);
      pending.clear();
      rejectStart(gone);
    });

    const threaded: ThreadedEmbedder = {
      model: EMBEDDING_MODEL,
      identity: embeddingIdentity(EMBEDDING_MODEL),
      embed: (texts) => {
        if (gone !== null) return Promise.reject(gone);
        const id = next;
        next += 1;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.ref();
          send({ id, texts });
        });
      },
      exited,
      close: async () => {
        if (gone !== null) return;
        worker.ref();
        send({ close: true });
        await exited;
      },
    };
  });
}
