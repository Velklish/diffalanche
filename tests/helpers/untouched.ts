/**
 * "This file was not written", by the time of the write and not by the bytes
 * ([06-cli.md](../../docs/reference/06-cli.md)).
 */
import { readFileSync, statSync, utimesSync } from "node:fs";
import { expect } from "vitest";

/** Far enough back that nothing under test writes it by accident. */
const STAMP = new Date("2020-01-01T00:00:00.000Z");

/** Stamps the file; the assertion it returns is called after the command. */
export function untouched(path: string): () => void {
  const before = readFileSync(path);
  utimesSync(path, STAMP, STAMP);
  return () => {
    expect(statSync(path).mtimeMs, `${path} was written`).toBe(STAMP.getTime());
    expect(readFileSync(path).equals(before), `${path} changed`).toBe(true);
  };
}
