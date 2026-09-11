# DA-104 · A security assertion in the server suite degrades to nothing when the machine has no external IP

- **Order:** 590
- **Scope:** 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

The server listens on `127.0.0.1` and nowhere else, and
[07-server.md](../../reference/07-server.md) states it as a property of the tool
rather than a default: "There is no host to pass and no flag that changes it".
The binding itself is one parameter's default — `hostname = "127.0.0.1"` at
[src/server/runtime.ts:25](../../../src/server/runtime.ts). One test guards it,
and it guards it conditionally.
[tests/server.test.ts:319-331](../../../tests/server.test.ts):

```ts
it("cannot be reached from another address of this machine", async () => {
  const outside = Object.values(networkInterfaces())
    .flat()
    .find((address) => address && address.family === "IPv4" && !address.internal);
  const server = await startReviewServer({ config: { ...config, port: 0 }, ui });
  try {
    expect(await (await fetch(`http://127.0.0.1:${server.port}/api/config`)).status).toBe(200);
    if (!outside) return;
    await expect(fetch(`http://${outside.address}:${server.port}/api/config`)).rejects.toThrow();
  } finally {
    await server.close();
  }
}, 120_000);
```

Line 326 returns instead of skipping. On a machine with no non-internal IPv4
interface — a network namespace, an IPv6-only runner, a laptop with the Wi-Fi
off — `outside` is `undefined`, the only assertion about the title never runs,
and what remains is that loopback answers 200, which every other test in the
file already establishes. The test reports green and says nothing about having
checked less.

The narrowed claim is that, and only that: the gate holds where the suite
usually runs, because GitHub's hosted runners do have an external IPv4
interface and therefore do execute line 327. What is wrong is that the
degradation is silent, so the one environment where the check is worth most —
a container whose network is deliberately constrained — is the one where it
quietly stops being a check. Nothing else covers the bind address: `grep -rn
"0\.0\.0\.0\|hostname" tests/` returns no lines. A change of that default to
`0.0.0.0` would therefore be reported as verified by a run that verified
nothing, and the thing exposed has no authentication at all —
[tests/write-api.test.ts:167](../../../tests/write-api.test.ts) says so in as
many words: "The server has no authentication: where a write came from is the
check."

The suite already has the right instrument for this. `tests/cli-comments.test.ts:417`
takes the vitest test context and calls `context.skip(reason)` when the runtime
cannot run the case, so the report names the gap.

## Work to do

- Replace the early return at `tests/server.test.ts:326` with a reported skip
  in the style of `tests/cli-comments.test.ts:414-419`: take `context` as the
  test's argument and call `context.skip()` with a sentence saying that this
  machine has no non-internal IPv4 interface and therefore the off-loopback
  reachability was not exercised.
- Decide, and say in the entry's result, whether a skip is enough or whether
  the property deserves a test that does not depend on the machine's
  interfaces. The candidates are: keep the skip only; add an assertion that
  reaches the server through an address that always exists on a loopback-only
  host, which on Linux is any other `127.0.0.0/8` address but is not portable
  to macOS; or assert the default directly by reading the `hostname` parameter
  a `startReviewServer` passes down, which tests the code rather than the
  socket. The first is small and honest, the third is cheap and weaker; picking
  one is part of this task, not a precondition for it.
- Check the rest of `tests/` for the same shape while the file is open — a bare
  `return` that skips the point of the test — and file anything found rather
  than fixing it here.

## Out of scope

- Changing the bind address, adding a `--host` flag, or adding authentication.
  The tool binds to loopback by decision, and this entry is about the test that
  says so.
- The structural flakiness of the suites, which is DA-60; its eight items do not
  include this one, and a silent skip is not a flake.
- The origin guard that trusts the `Host` header, filed as DA-62. That is a
  different defence at a different layer: this one is the socket, that one is
  what the server accepts once a request arrives.

## Verification

- On a machine with an external IPv4 interface the test still executes the
  off-loopback assertion and passes; on one without, the run reports a skip
  naming the reason instead of a pass.
- The mutation probe: change the default at `src/server/runtime.ts:25` to
  `0.0.0.0` and run `bun run test` — the test must fail on a connected machine.
  Then run it with the interfaces unavailable and confirm the report says
  skipped, not passed.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
  `bun run perf` is untouched by this change.
