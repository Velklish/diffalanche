/**
 * Which runtime the unit suite is running on. `bun run test` starts Vitest
 * through Bun, but Vitest runs the tests themselves on Node — inside a test
 * `process.versions.bun` is undefined and `process.execPath` is the Node
 * binary. `bun run test:bun` is what puts them on Bun's own runtime, and this
 * is the check that says which of the two happened: a Vitest that quietly went
 * back to spawning Node workers fails the job that asked for Bun instead of
 * passing it. See [11-perf.md](../docs/reference/11-perf.md).
 */
import { expect, test } from "vitest";

const RUNTIME = process.versions.bun === undefined ? "node" : "bun";

test("the suite runs on the runtime it was asked to run on", () => {
  // Node is the default because `bun run test` is: the runner is Vitest and
  // its workers are Node processes. `bun run test:bun` names the other one.
  const asked = process.env.DIFFALANCHE_TEST_RUNTIME ?? "node";
  expect(
    RUNTIME,
    `the suite is running on ${RUNTIME} and DIFFALANCHE_TEST_RUNTIME asks for ${asked}: ` +
      "`bun run test:bun` is the command that runs it on Bun, and it sets the variable itself",
  ).toBe(asked);
});
