/** The embedder in a process of its own: the parent writes texts to its standard input and reads
 * vectors from its standard output, a line of JSON each (09-ml.md, "In a process of its own"). */
import { createInterface } from "node:readline";
import type { Embedder } from "./embedder.ts";
import { ModelError } from "./errors.ts";

/** Where a patched build's `onnxruntime-node` loads its binding from (scripts/build.ts). */
declare global {
  var __diffalancheOrtBinding: string | undefined;
}

/** Set in the environment of the process started as the embedder: a binary reads it to run
 * `serveChild`, and the child takes it out of its own environment. */
export const CHILD = "DIFFALANCHE_EMBEDDER";

/** The first line: where the model is, and the binding a channel's build loads (`open.ts`). */
export type Start = { location: string; binding: string | undefined };
export type Question = { texts: string[] } | { peak: true };
export type Request = Question & { id: number };
/** A vector travels as the base64 of its `float32` bytes: the parent gets the bytes, not a print. */
export type Reply =
  | { ready: true }
  | { id: number; vectors: string[] }
  | { id: number; peak: number }
  | { id: number | null; error: string };

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function answer(reply: Reply): void {
  process.stdout.write(`${JSON.stringify(reply)}\n`);
}

/** The runtime is imported only after the binding it loads is set: a channel's build points its
 * `require` at that path (09-ml.md, "Delivery"). */
async function load(start: Start): Promise<Embedder> {
  globalThis.__diffalancheOrtBinding = start.binding;
  let module: typeof import("./embedder.ts");
  try {
    module = await import("./embedder.ts");
  } catch (error) {
    throw new ModelError(`the embedding runtime could not be loaded: ${reason(error)}`);
  }
  return module.embedder(start.location);
}

async function serve(loaded: Promise<Embedder>, request: Request): Promise<void> {
  try {
    if ("peak" in request) {
      answer({ id: request.id, peak: process.resourceUsage().maxRSS });
      return;
    }
    const vectors = await (await loaded).embed(request.texts);
    answer({
      id: request.id,
      vectors: vectors.map((one) =>
        Buffer.from(one.buffer, one.byteOffset, one.byteLength).toString("base64"),
      ),
    });
  } catch (error) {
    answer({ id: request.id, error: reason(error) });
  }
}

/** The model's process: called by its entry and by nothing else (`child-entry.ts`, the binary's). */
export function serveChild(): void {
  delete process.env[CHILD];
  let loaded: Promise<Embedder> | null = null;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (loaded === null) {
      loaded = load(JSON.parse(line) as Start);
      loaded.then(
        () => answer({ ready: true }),
        (error: unknown) => answer({ id: null, error: reason(error) }),
      );
      return;
    }
    void serve(loaded, JSON.parse(line) as Request);
  });
  // Standard input ends when the parent closes it or is gone, however it went: this ends too.
  lines.on("close", () => process.exit(0));
}
