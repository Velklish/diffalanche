# DA-63 · The perf gate deletes any --fixture directory itself, bypassing the generator's overwrite guard

- **Order:** 30
- **Scope:** 11-perf (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

[perf/gate.ts:21](../../../perf/gate.ts):

```ts
function prepare(fixture: string): void {
  const current = join(fixture, ".diffalanche", "current");
  if (!existsSync(fixture) || !existsSync(current)) {
    rmSync(fixture, { recursive: true, force: true });
    execFileSync("bun", ["run", "synth", "--", "--out", fixture], { stdio: "inherit" });
  }
```

`--fixture` is free-form and unvalidated —
[perf/harness.ts:327](../../../perf/harness.ts) takes whatever follows it — and
`docs/reference/11-perf.md` advertises the flag: `bun run perf -- --fixture
/tmp/x   # another fixture`.

The guard that makes this safe exists, and it is in the wrong process.
[scripts/synth.ts](../../../scripts/synth.ts) has `assertOverwritable`, which
throws on a directory that "is not empty and holds no `.diffalanche/` from an
earlier run", and `docs/reference/11-perf.md` names the exact hazard it exists
for: "without that check `--out .` in a checkout would take the working tree and
its `.git` with it". The gate erases *before* spawning `synth`, so
`assertOverwritable` never sees the path.

`bun run perf -- --fixture .` from the repository root is the worst case:
`existsSync(".")` is true, `existsSync("./.diffalanche/current")` is false
because the repository has no `.diffalanche/`, and `rmSync(".", { recursive:
true, force: true })` runs against the working tree and `.git`. Any path without
a `.diffalanche/current` inside it behaves the same — `..`, a sibling checkout, a
home directory reused from an earlier run — with no prompt and no output before
the deletion.

This has not been observed happening. The mechanism is read from the code and
the destructive line is unconditional once the `if` is entered; nobody has run it
against a real directory, and nobody should.

## Work to do

- Give the gate the same guard the generator has, before the `rmSync`: refuse a
  path that is not empty and holds no `.diffalanche/` from an earlier run. The
  check belongs to whoever erases, so the gate cannot delegate it by spawning.
- Do not fix this by deleting less. A gate that erases a stale fixture is the
  intended behaviour; what is missing is the question "is this a fixture at all".
- Refuse the paths that can never be a fixture whatever they contain: the
  repository root, its ancestors, and the home directory.
- Say in `docs/reference/11-perf.md` that `--fixture` names a directory the gate
  owns and may erase, and what it refuses.

## Out of scope

- `scripts/synth.ts`'s own guard, which works.
- Whether the fixture should live somewhere outside the repository by default.

## Verification

- `bun run perf -- --fixture <a directory with files and no .diffalanche>` exits
  non-zero with a message naming the directory, and the directory is untouched
  afterwards — asserted on a temporary directory, by listing it after the run.
- `bun run perf -- --fixture .` refuses, and a test covers it without ever
  reaching `rmSync`.
- The normal path still works: a stale fixture directory left by an older
  generator is erased and regenerated.
- `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun` and
  `bun run perf` are green.
