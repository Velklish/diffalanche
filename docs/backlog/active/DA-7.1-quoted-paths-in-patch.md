# DA-7.1 · A path git quotes or pads comes out of the parser as a different path

- **Scope:** 02-git (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-7
- **Taken:** 2026-09-05

## Context

`gitdiff-parser`, the parser DA-7 takes the structured shape from
([02-git.md](../../reference/02-git.md)), reads the paths of a patch literally.
Git does not always write them literally: a path with a character outside ASCII
is quoted with octal escapes, and a path with a space keeps the tab git pads the
`---` and `+++` lines with. Both come through as the path, and neither is one.

Verified against `readRepositoryChange` on a repository holding a file named
`файл.ts` and one named `sp ace.ts`:

```
$ git diff HEAD --no-color --no-ext-diff -U3
diff --git "a/\321\204\320\260\320\271\320\273.ts" "b/\321\204\320\260\320\271\320\273.ts"
--- "a/\321\204\320\260\320\271\320\273.ts"
+++ "b/\321\204\320\260\320\271\320\273.ts"
diff --git a/sp ace.ts b/sp ace.ts
--- a/sp ace.ts<TAB>
+++ b/sp ace.ts<TAB>
```

```json
{"path":"/\\321\\204\\320\\260\\320\\271\\320\\273.ts\"","oldPath":null,"status":"modified"}
{"path":"plain.ts","oldPath":null,"status":"modified"}
{"path":"sp ace.ts\t","oldPath":null,"status":"modified"}
```

`plain.ts` is right; the other two are not. The consequences reach past display:
the path is the id a comment anchors to (`comments.json`, `docs/SPEC.md` section
7), the argument of `diff --repo`/`comment --path` (section 8), and what an
agent opens on disk (`<root>/<repo>/<path>`). A file whose name git escapes can
therefore be commented on but never found again.

The same limitation existed in the Phase 0 spike, where the split of the
`diff --git` line was ours. DA-7 moved it into the library, and this entry is
where it is recorded rather than lost.

## Work to do

- Undo git's quoting where it happens: a header path wrapped in double quotes is
  C-style quoted, with octal escapes for the bytes of a UTF-8 name.
- Strip the tab git pads a `---`/`+++` path with when the path contains a space.
- Decide where the fix lives: a normalisation pass over the parser's output in
  `src/core/git/patch.ts`, or `-c core.quotePath=false` on the diff call, which
  removes the quoting but not the padding and changes nothing about `diff --git`.

## Out of scope

- Any other property of the parser. The hunk counts it reports for a header of
  `@@ -1,2 +0,0 @@` are wrong too, but DA-7 does not expose them
  ([02-git.md](../../reference/02-git.md)).

## Verification

- A fixture repository with a file named outside ASCII and one with a space in
  its name: `readRepositoryChange` reports both paths exactly as
  `git ls-files` prints them, and `join(root, repo, path)` opens each file.
