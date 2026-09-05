# 11 · Synthetic review generator and the performance gate

`scripts/synth.ts` builds the synthetic review: the fixture the performance
gate, the diff rendering spike, and the scanner and storage tests all measure
against. The performance gate itself does not exist yet.

## Running it

```sh
bun run synth -- --out <dir> [--seed <n>] [--small]
```

| Option | Meaning |
|---|---|
| `--out <dir>` | Root of the generated review. Required; the directory is emptied first, and refused if it holds anything other than an earlier run |
| `--seed <n>` | Seed for every random choice. Default `1` |
| `--small` | The small profile instead of the full one |

The script prints the totals it measured and exits. It erases `--out` before
filling it, so it refuses a directory that exists, is not empty, and has no
`.diffalanche/` from an earlier run: without that check `--out .` in a checkout
would take the working tree and its `.git` with it. Failure is one line on
stderr and exit code 1.

## Profiles

| Profile | Repositories with changes | Files | Changed lines | Comments |
|---|---|---|---|---|
| full (default) | 21 | 300 | 30 000 | 200 |
| `--small` | 3 | 20 | 2 000 | 20 |

The full profile is the synthetic review of `docs/SPEC.md` section 6. The small
one exists so a unit test can run the same code path in a second.

**The file and line counts are the change set, not `git diff`.** The change set
is what the spec means by a diff (section 3, decision 4): tracked edits plus
untracked files. `git diff` never reports an untracked file — only
`git add --intent-to-add` would put one there, and that writes to a repository's
index, which the tool must never do. So the generator's totals are the sum of
the two, and it prints all three numbers:

```
synthetic review at /tmp/synth
    21 repositories with changes; a scan finds 22, the extra one
       being the clean sibling worktree
  git diff         279 files   27894 lines
  untracked         21 files    2106 lines
  change set       300 files   30000 lines
   200 comments in reviews/synth/comments.json
```

A changed line is an insertion or a deletion, counted as `git diff --numstat`
counts them. The change set totals are exact, not approximate.

## What it produces

```
<out>/
  repos/<group>/<repo>/          21 repositories, each a git working tree
  repos/core/cargos-api-worktree/   a worktree of the first repository, checked out clean
  repos/core/cargos-api/vendor/lib/ a submodule nested inside the first repository
  sources/vendor-lib/            the submodule's source, outside repos/ so a scan never sees it
  .diffalanche/                  the data directory
```

Every repository is a `git init` with one base commit, then working-tree edits
on top: one file per repository is left untracked, the rest are committed and
then rewritten in place, one block replaced per file. Generated content is
TypeScript, C#, Python, Go, and Markdown in equal rotation, in whole functions,
classes, and sections rather than loose lines.

The two extra entries exist for the scanner (`docs/SPEC.md` section 10): the
sibling worktree must be listed as a repository of its own, the nested submodule
must not be listed at all. The worktree carries no changes, so the review shows
21 repositories while a scan finds 22.

The data directory holds `config.json` — `roots: ["repos"]`, `depth: 2`, without
which the default `roots: ["."]` and `depth: 2` would not reach
`repos/<group>/<repo>` — and one review session `reviews/synth/` with
`review.json` and `comments.json` in the format of `docs/SPEC.md` section 7.
There is no `diff.json`: git is the source of truth and the scanner writes that
cache itself. There is no `current` pointer either — `docs/SPEC.md` section 7
names that file but does not fix its content, and the storage subsystem is what
defines it, so until then a consumer of the fixture names the session with
`--review synth`.

Comments are spread over all four anchor levels (review, repository, file, line)
and all four severities; a line comment's anchor names a line inside the block
its file actually changed, with its real context and hunk header.

## Determinism

Two runs with the same seed produce byte-identical trees outside `.git`. The
seed drives every choice, and the git author, committer, and dates are fixed
through environment variables, so the commits are reproducible too. `.git`
itself is not comparable: object mtimes differ, and the sibling worktree's
`.git` file holds an absolute path.

`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are pointed at the null device for
every git call, so a developer's own git configuration cannot change the
fixture.

The generator reaches its line target in two passes. A planned edit of `d` old
lines into `i` new ones does not yield `d + i` changed lines: realistic code
repeats `}` and blank lines, git matches those across the replaced block and
counts them as context — about a quarter of the plan on these profiles. The
first pass writes the plan and measures it; the second appends uniquely
numbered lines until the measured change set matches the profile exactly.

Top-up only adds lines, so a plan that overshot the profile could not be brought
back down. It cannot overshoot: every file is allotted a floor of changed lines
before the remainder is spread by weight, so the parts always sum to the profile
exactly. The generator checks the finished change set against the profile and
throws when they differ, which is what makes "exact, not approximate" a promise
rather than an observation.

## Verifying it by hand

```sh
bun run synth -- --out /tmp/a --small
bun run synth -- --out /tmp/b --small
diff -r --exclude=.git /tmp/a /tmp/b     # no output
```

`tests/synth.test.ts` runs the small profile twice in temporary directories and
checks the same properties: the profile counts, the tracked and untracked split,
the sibling worktree and the nested submodule, the on-disk format, that every
line comment sits on the line it names, that a foreign directory is refused
untouched, and that the two trees are byte-identical.
