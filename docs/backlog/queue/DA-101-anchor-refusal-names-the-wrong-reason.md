# DA-101 · captureAnchor refuses a line with "has no hunks in the change set" when the file has hunks on the other side

- **Order:** 560
- **Scope:** 04-domain (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

`captureAnchor` has two refusal messages for a line it cannot anchor, and it picks the wrong one whenever *every* hunk of the file lacks line numbers on the requested side. That is not only the deleted-file case: a fully deleted file asked about with `--side new` and an added file asked about with `--side old` both land there, and both are told the file has no hunks when the file is nothing but hunks.

The mechanism is in two functions. `distanceTo` reports `+Infinity` for a hunk that has no number on the side being asked about, and `nearest` compares with a strict `<` against a `bestDistance` that starts at `+Infinity`, so it returns `null` even though it walked a non-empty list:

[src/core/domain/anchors.ts:43-67](../../../src/core/domain/anchors.ts)

```ts
/** How far a line is from a hunk on the chosen side; `0` while inside it. */
function distanceTo(hunk: Hunk, side: Side, line: number): number {
  const numbers = hunk.lines
    .map((one) => lineNumber(one, side))
    .filter((one): one is number => one !== null);
  const first = numbers[0];
  const last = numbers.at(-1);
  if (first === undefined || last === undefined) return Number.POSITIVE_INFINITY;
  ...
}

function nearest(file: FileChange, side: Side, line: number): Hunk | null {
  let best: Hunk | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hunk of file.hunks) {
    const distance = distanceTo(hunk, side, line);
    if (distance < bestDistance) { ... }
  }
  return best;
}
```

`null` then selects the branch that speaks about the file as a whole rather than about the side (`anchors.ts:100-109`): `` `${repo}/${path} has no hunks in the change set, so line ${line} cannot be anchored` ``.

Reproduced by calling the module directly under Bun, with one deleted file carrying a single hunk `@@ -1,3 +0,0 @@` of three delete lines:

```
$ bun probe.ts
new 2 -> r/gone.ts has no hunks in the change set, so line 2 cannot be anchored
old 9 -> line 9 of r/gone.ts is not in the change set on the old side; the nearest hunk is @@ -1,3 +0,0 @@
```

The path is reachable from the CLI rather than only from a unit call: `findFile` ([src/core/domain/anchors.ts:23-41](../../../src/core/domain/anchors.ts)) rejects only a missing repository, a missing file, or one with `omitted !== null`, and a deleted text file has `omitted: null` with hunks ([src/core/git/patch.ts:91](../../../src/core/git/patch.ts)); the comment command defaults the side to `new` (`side: choice(args, "side", SIDES) ?? "new"`, [src/cli/commands/comment.ts:76](../../../src/cli/commands/comment.ts)). So `diffalanche comment --repo r --path gone.ts --line 2 …` on a deleted file produces the false message today.

What the message costs is exactly what [docs/reference/04-domain.md:258-262](../../reference/04-domain.md) promises it will not: the nearest hunk is named "because the bare refusal leaves the writer guessing where the diff is". Here the writer is given less than a bare refusal — a false statement about the file, and no mention of the side, which is the one thing that would let them retry. Compare the omitted-file refusal a few lines above, which both says which kind of omission it is and points at the file-level anchor as the way out.

No test covers it. `tests/comments.test.ts:176` ("refuses a line the change set does not have and names the nearest hunk") asserts `/the nearest hunk is @@ -\d+/` on a modified file, which is the branch that already works.

## Work to do

- Make `nearest` mean what its name says: a hunk that has no lines on the requested side is not "infinitely far", it is not a candidate for a distance at all, while a file that has hunks is never a file without hunks. Either drop `+Infinity` in favour of a `null` distance that `nearest` skips explicitly, or keep the scoring and decide the branch at the call site on `file.hunks.length` rather than on `closest === null`.
- Decide what the refusal should say when the file has hunks but none on this side; the two candidates are to name the other side as the one that carries the lines ("`gone.ts` is deleted and has lines on the old side only; retry with `--side old`"), or to stay generic and name the nearest hunk measured on the side that does have numbers. The first is more useful and couples the message to the file's status; the second is a smaller change. Pick one and write it in `docs/reference/04-domain.md` next to the existing promise.
- Keep the genuinely empty case — a file with `hunks: []` and `omitted: null`, if it can occur — answerable with the current sentence, or establish that it cannot occur and remove the branch under DA-59 rather than here.
- Cover both directions in `tests/comments.test.ts`: a deleted file with `side: "new"` and an added file with `side: "old"`.

## Out of scope

- The default `side: "new"` in the comment command. Changing the default per file status is a CLI contract change and is not what this task is about; the refusal has to be honest whatever the default is.
- File-level comments on deleted files, which already work through `findFile`'s omitted branch and through the file anchor level.
- Re-anchoring after the code moves, which reads the anchor this function produced and is untouched.
- The comment-length rule on the touched functions beyond what an edited line requires — the sweep is DA-58.

## Verification

- `bun` probe of `captureAnchor` on a deleted file with one hunk: `side: "new"` produces a message that mentions neither "has no hunks" nor a line that does not exist, and the added-file mirror with `side: "old"` behaves the same way.
- New tests in `tests/comments.test.ts` for both directions; reverting the `nearest` fix while keeping the tests turns them red on the message assertion, not only on the error code — `line-not-in-diff` is thrown either way, so an assertion on `code` alone would not be a probe.
- Gates: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`.
- `docs/reference/04-domain.md` states the chosen wording, so the next reader can tell the two refusals apart without reading `anchors.ts`.
