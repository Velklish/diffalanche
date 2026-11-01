/** Process output errors are exercised at the shared stream interface (06-cli.md). */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processOutput } from "../src/cli/output.ts";

class Stream extends EventEmitter {
  written: string[] = [];

  write(text: string): boolean {
    this.written.push(text);
    return true;
  }
}

describe("process output errors", () => {
  // Bun keeps the previous status when assigned undefined, so restore an explicit success status.
  const saved = process.exitCode ?? 0;
  beforeEach(() => {
    process.exitCode = saved;
  });
  afterEach(() => {
    process.exitCode = saved;
  });

  for (const channel of ["out", "err"] as const) {
    it.each(["EPIPE", "ENOTCONN"])(`ignores %s on ${channel} after its reader leaves`, (code) => {
      const out = new Stream();
      const err = new Stream();
      const stream = channel === "out" ? out : err;
      const io = processOutput(out, err);
      io[channel]("before\n");
      stream.emit("error", Object.assign(new Error(`write ${code}`), { code }));
      io[channel]("after\n");
      expect(process.exitCode).toBe(saved);
      expect(stream.written).toEqual(["before\n"]);
      if (channel === "out") expect(err.written).toEqual([]);
    });

    it.each(["ENOSPC", "EIO", "EBADF"])(`reports %s on ${channel} as exit 2`, (code) => {
      const out = new Stream();
      const err = new Stream();
      processOutput(out, err);
      const stream = channel === "out" ? out : err;
      stream.emit("error", Object.assign(new Error(`write ${code}`), { code }));
      expect(process.exitCode).toBe(2);
      expect(out.written).toEqual([]);
      expect(err.written).toEqual(
        channel === "out" ? [`diffalanche: standard output: write ${code}\n`] : [],
      );
    });
  }
});
