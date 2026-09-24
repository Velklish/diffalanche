import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** A question on the terminal, answered by a line: `y` or `yes` is yes; `Ctrl-C` and `Ctrl-D` are
 * no. `null` when input is not a terminal — a script has nobody to answer, and says `--yes`. */
export async function confirmOnTerminal(
  question: string,
  input: Readable & { isTTY?: boolean } = process.stdin,
  output: Writable = process.stderr,
): Promise<boolean | null> {
  if (input.isTTY !== true) return null;
  const lines = createInterface({ input, output });
  try {
    const answer = await new Promise<string>((done) => {
      // Closed before a line came — `Ctrl-D`, or `Ctrl-C`, which readline answers by closing — is no.
      lines.once("close", () => done(""));
      lines.question(`${question} [y/N] `, done);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    lines.close();
  }
}

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
