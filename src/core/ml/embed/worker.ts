/** The embedder on a thread of its own: the server's event loop hands it texts and waits for
 * vectors instead of running the model itself (09-ml.md, "In the server"). */
import { parentPort, workerData } from "node:worker_threads";
import { embedder } from "./embedder.ts";

export type Request = { id: number; texts: string[] } | { close: true };
export type Reply =
  | { ready: true }
  | { id: number; vectors: Float32Array[] }
  | { id: number | null; error: string };

const port = parentPort;
if (port !== null) {
  const loaded = embedder((workerData as { location: string }).location);
  loaded.then(
    () => port.postMessage({ ready: true } satisfies Reply),
    (error: unknown) => port.postMessage({ id: null, error: String(error) } satisfies Reply),
  );
  port.on("message", async (request: Request) => {
    // `terminate()` of a thread that loaded the runtime aborts Bun 1.3.14; exiting from inside does not.
    if ("close" in request) process.exit(0);
    try {
      const vectors = await (await loaded).embed(request.texts);
      port.postMessage(
        { id: request.id, vectors } satisfies Reply,
        vectors.map((one) => one.buffer as ArrayBuffer),
      );
    } catch (error) {
      port.postMessage({ id: request.id, error: String(error) } satisfies Reply);
    }
  });
}
