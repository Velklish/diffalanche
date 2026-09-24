/** A child that loads, says it is ready, and ends at the first request with a line on standard
 * error, as one the system killed would (tests/suggest.test.ts). */
import { createInterface } from "node:readline";

let started = false;
createInterface({ input: process.stdin }).on("line", () => {
  if (started) process.stderr.write("Error: ended by the test\n", () => process.exit(3));
  started = true;
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
});
