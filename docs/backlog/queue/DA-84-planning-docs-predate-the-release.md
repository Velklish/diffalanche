# DA-84 · SPEC's status line and ROADMAP's phase table still describe the project before Phase 1 shipped

- **Order:** 390
- **Scope:** all subsystems (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

Two planning documents describe a project that has not started writing code. It has.

[docs/SPEC.md:3](../../SPEC.md) reads:

```
Status: approved requirements, amended 2026-09-05 after UI/UX design; pre-implementation. Owner: Velklish. License: MIT.
```

`git tag -l` prints `v0.1.0`, and [CHANGELOG.md](../../../CHANGELOG.md) carries a released `## [0.1.0] - 2026-09-05` section at line 160. (The audit cited that heading at line 153; the file has grown since, and the heading is the stable landmark, not the number.) [README.md:14](../../../README.md) states the opposite of the spec in the project's own front matter: "**Status:** Phase 1, in development. The CLI, the storage, the scanner, the git reader, the review server and the UI are in". The claim to correct is the narrow one the verifier left standing: this is a single stale clause in a status line. No requirement text elsewhere in SPEC.md is wrong because of it.

The "frozen historical prose" reading does not hold. `git log --oneline -- docs/SPEC.md` shows the document amended after the release — `4be4936 DA-53` and `1079222 DA-55` — and [docs/README.md:7](../../README.md) lists it as "Approved, amended 2026-09-05" with no marker that the status line is deliberately historical. `grep -rn pre-implementation docs/ README.md` finds the line itself and one archived task, `docs/archive/DA-1-repository-skeleton/task.md:19`, which removed the same wording from `README.md` and left SPEC.md alone. Untracked drift, not a decision.

[docs/ROADMAP.md:6-7](../../ROADMAP.md) has the second half:

```
2. **Phase 1 — MVP: … Acceptance criteria are in SPEC.md section 10. Tasks DA-6 to DA-32.**
3. **Phase 2 — suggestions and context. … Tasks DA-33 to DA-41.**
```

`git log --oneline -- docs/ROADMAP.md` returns two commits, `e213168` (bootstrap) and `a93ea53` (a backslop pin bump) — the phase table has not been touched since the project was cut. Meanwhile `git log -- docs/SPEC.md` shows DA-53 and DA-55 adding entries to section 10's **Phase 1** acceptance list: `review scope remove` with a comment under it (SPEC.md:274), `review close` / `review reopen` refusing a non-`human` role (:275), and `review.json` version 1 read as version 2 (:276). Those criteria were implemented by tasks now in `docs/archive/` as DA-51 through DA-56, all numbered above the DA-6…DA-32 range the roadmap gives Phase 1, while every DA-33…DA-41 is still sitting in `docs/backlog/queue/`. The roadmap's highest number is DA-49 (Phase 4), so DA-50 and up belong to no phase by the document's own text.

What follows is small and entirely editorial: a reader who opens the canonical spec — the first row of `docs/README.md`'s table — to learn where the project stands is told implementation has not begun, and a reader who uses the roadmap to map task numbers onto phases gets a partition that stopped being true around DA-50.

## Work to do

- Rewrite the status clause in [docs/SPEC.md:3](../../SPEC.md) so it states the real state, and pick the wording that will not rot the same way — a phase name plus the release, rather than a point-in-time "pre-implementation". If the amendment date is meant to keep tracking the last edit, it has to be updated by whoever edits the document; deciding whether it does is part of this task.
- Decide first what the roadmap's task ranges are *for*. Two candidates, and this entry does not choose: keep them as a historical record and correct them (Phase 1 runs to DA-56 and the Phase 2 range starts wherever the queue actually starts), or drop the per-phase task numbers entirely and let `backslop status` and the acceptance list in SPEC section 10 be the only mapping — the roadmap already says tasks with statuses live there.
- Whichever is chosen, make [docs/ROADMAP.md](../../ROADMAP.md) account for DA-50 and above, which currently sit in no phase.
- Check the three status claims against each other in one pass — SPEC.md:3, README.md:14, and the Status column of `docs/README.md` — so the fix does not leave a third variant behind.

## Out of scope

- The requirement text of SPEC.md. Only the status line is stale; the sections themselves were amended with the code that implemented them.
- Renumbering or re-filing any task. Nothing moves between `queue/`, `active/` and `archive/` here.
- Whether the phases themselves are still the right plan, and whether Phase 1 is finished. This entry records where the work landed; it does not declare a phase closed.
- The npm claim in README.md ("nothing is published to npm yet") — it matches the recorded decision to release without npm and is not drift.

## Verification

- `grep -rn pre-implementation docs/ README.md` returns nothing outside `docs/archive/`.
- SPEC.md:3, README.md:14, and the SPEC row of `docs/README.md` make the same claim about where the project is, and a reader who opens any one of them first is not misled by it.
- Either `docs/ROADMAP.md` names no task numbers at all, or every archived and queued task number falls inside exactly one phase it names.
- `npx github:Velklish/backslop#v0.4.0 lint` is green: it is the gate that catches a link broken while editing these files. The code gates (`bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`, `bun run perf`) are untouched by a documentation-only change and need no re-run beyond the usual pass.
