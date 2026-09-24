# DA-55.9 · The watcher verdict on repositories that moved while unfollowed fails alone and under load

- **Scope:** 05-watcher
- **Created:** 2026-09-24
- **Parent:** DA-55.6
- **Cost:** minor

## Evidence

Finding discovered while working on DA-40. The verdict
`tests/watcher.test.ts > a move of current > says which repositories moved while
nobody followed the task, after it follows it` expects exactly one
`diff-changed` after `current-changed`:

<!-- quote:../../../tests/watcher.test.ts -->
      expect(moved.map((event) => (event as { repo: string }).repo)).toEqual([REPO]);
<!-- /quote -->

On 2026-09-24 it received `["repos/core/cargos-api", "repos/platform/loads-search"]`
in four ways:

- in the gate series of worker:wave3 on `416d156` (`bun run test`, Node, load 33
  at the start), with the whole suite;
- run **alone** (`npx vitest run tests/watcher.test.ts -t "<the name>"`) on
  `416d156` twice and on `1fff4f6` — the commit before DA-40's round — twice:
  exit 1 all four times, the same assertion and the same extra repository;
- the whole file on both commits passed, 45/45, exit 0.

So the verdict leans on something the tests before it in the file leave behind,
and under load it fails with them too; what the extra `diff-changed` for
`repos/platform/loads-search` is — a stale entry of the fixture's cache, or an
edit of another test landing late — was not traced. It is not DA-40's: the same
red is on `1fff4f6`.
