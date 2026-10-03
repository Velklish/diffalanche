# Closed task journal

One line per task: number with slug, closing date, outcome, closing commit, and title. The body is not in the tree — the definition and the result live in git, and `npx --no-install backslop show N` retrieves them. Lines are appended at the end: a single fold adds its own line, a bulk fold adds its lines by closing date, equal dates by number.

An `—` outcome means that `result.md` did not name one. An `—` commit means that the body is in no revision the line could name. After `npx --no-install backslop fold N` it is only in the message of the fold commit, so commit the draft, and `show` finds it by the task section in a commit message, then by the `DA-N:` subject. After a bulk fold the body was not in history: it is in the draft if `--embed-missing` was given, and otherwise it is lost.

- <a id="da-119"></a>`DA-119-backslop-020-base` · 2026-10-03 · completed · — · backslop v0.20.0: pin, hooks for claude, and the layout errors outside documentation
- <a id="da-121"></a>`DA-121-backslop-020-adr-changelog` · 2026-10-03 · completed · — · ADRs and the unreleased CHANGELOG state their facts without task numbers
- <a id="da-120"></a>`DA-120-backslop-020-docs` · 2026-10-03 · completed · — · Documentation states its facts without task numbers: README, reference, design, spec, glossary
