# DA-122 · The whole archive folds into the closed task journal

- **Order:** 750
- **Scope:** all subsystems (see [reference](../../reference/README.md)); `docs/archive/`
- **Created:** 2026-10-03
- **Dependencies:** DA-120, DA-121

## Context

backslop v0.20.0 keeps closed tasks as lines of `docs/archive/LOG.md`: `fold` takes a
task directory out of the tree, writes its line (date, outcome, revision) and points
incoming links at the line's anchor. `docs/archive/` holds 177 task directories on
`b5092d2`. The fold comes after DA-120 and DA-121 because it rewrites incoming links
into the archive and those two tasks remove them.

## Work to do

- Fold the whole archive.
- Check the journal lines: date, outcome and revision, by a sample read against the
  folded `result.md` and by count against the number of directories folded.

## Out of scope

- Editing a task's text while folding it.

## Verification

- `docs/archive/` holds only `LOG.md`, its README, and what the template keeps.
- The line count of `LOG.md` matches the folded directories; `show N` prints a folded
  body for a sample of numbers.
- `lint` and every other gate exit 0.
