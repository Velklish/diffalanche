/**
 * All of standard input, which is what `--body -` reads. `process.stdin` is
 * async-iterable in Node and in Bun, and the decoder is fed chunk by chunk so a
 * character split across two of them survives.
 */
export async function readStandardInput(): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of process.stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
