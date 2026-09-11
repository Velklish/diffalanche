# DA-83 · The severity order is written out twice, against the decision that storage holds the only copy

- **Order:** 380
- **Scope:** 04-domain, 03-storage (see [reference](../../reference/README.md))
- **Created:** 2026-09-11
- **Dependencies:** none

## Context

Storage owns the severity list and says so in the comment above it:

[src/core/storage/types.ts:53-59](../../../src/core/storage/types.ts)

```ts
/**
 * The values themselves, in the order they are written about: the schema checks
 * a file against them and the CLI checks a flag against them, and two lists of
 * the same four words drift the moment one of them gains a fifth.
 * `SEVERITIES` is worst first (`docs/SPEC.md` section 3, decision 7).
 */
export const SEVERITIES: readonly Severity[] = ["critical", "warning", "nit", "question"];
```

The domain writes the same four words again, citing the same decision:

[src/core/domain/counters.ts:9-10](../../../src/core/domain/counters.ts)

```ts
/** Worst first. `docs/SPEC.md` section 3, decision 7. */
const SEVERITY_ORDER: readonly Severity[] = ["critical", "warning", "nit", "question"];
```

`grep -rn '"critical"' src/` returns exactly three lines — the type at `storage/types.ts:29`, `SEVERITIES` at `storage/types.ts:59`, and this one. Every other consumer takes the exported list: `src/ui/types.ts:35` re-exports it, `src/core/storage/schema.ts:148` validates against it, `src/server/request.ts:117` checks a request body against it, `src/cli/comments.ts:9` hands it to `comment` and `list`. So this is not a house style with one exception; it is one module opting out of a list everything else imports. `docs/archive/DA-13-cli-core/result.md:3` records the rule as closed work: "The value lists `SEVERITIES`, `ROLES`, `SIDES`, `COMMENT_STATUSES` are exported once from `src/core/storage/types.ts`." The copy contradicts a recorded decision rather than being one.

`SEVERITY_ORDER` has one consumer, and it is load-bearing:

[src/core/domain/counters.ts:53-63](../../../src/core/domain/counters.ts)

```ts
export function worstSeverity(comments: Comment[]): Severity | null {
  for (const severity of SEVERITY_ORDER) {
    if (comments.some((comment) => comment.severity === severity)) return severity;
  }
  return null;
}
```

That value is the colour of every badge: `countComments` (`counters.ts:49`) feeds `countReview`, which the server computes at `src/server/review.ts:131` and `:228` and which the UI recomputes for itself at `src/ui/store.ts:1566`, and `src/ui/components/FileCard.tsx:253` calls `worstSeverity` directly.

The failure this enables is hypothetical, in those words: nobody has added a fifth severity. If one is added, `SEVERITIES` gains an entry so the schema and the CLI accept it, while a four-element literal still satisfies `readonly Severity[]` and type-checking stays green; `worstSeverity` then returns `null` for a scope whose only open comment carries the new value, and the header, the repository badge and the file badge paint it as carrying no open finding. The debt is not hypothetical — the second list exists today and no test pins the two together (`grep -rn SEVERITY_ORDER tests/` is empty).

Nothing blocks the import. `counters.ts:7` already reads `import type { Comment, Severity } from "../storage/types.ts";`, and the module cycle that would make a value import unsafe does not exist at runtime: `src/core/types.ts:1-2` imports `domain/counters.ts` and `storage/types.ts` with `import type`, which is erased. Precedent for the domain importing a value from storage is `src/core/domain/sessions.ts`.

A fourth copy lives at `scripts/synth.ts:458`, in the fixture generator rather than the product path; see "Out of scope".

## Work to do

- Delete `SEVERITY_ORDER` from [src/core/domain/counters.ts](../../../src/core/domain/counters.ts) and have `worstSeverity` iterate `SEVERITIES`, imported as a value from `../storage/types.ts` on the import line that is already there.
- Decide where the "worst first" fact is stated once. `SEVERITIES` already carries it in its comment; the pointer left in `counters.ts` should say that the order comes from storage rather than restate the decision, and it has two lines to do it in ([ADR-011](../../adr/adr-011-comment-length.md)).
- Add a test that fails when the two drift — the honest shape is one that asserts `worstSeverity` returns the first entry of `SEVERITIES` that is present, driven off `SEVERITIES` itself rather than off a hand-written list, so a fifth value is covered the day it is added.
- Say in [docs/reference/04-domain.md](../../reference/04-domain.md), where the counters' `severity` field is described at lines 287-288, that the ordering is storage's list and not the domain's own.

## Out of scope

- The copy at `scripts/synth.ts:458`. It is a generator that writes fixtures, outside the product path, and whether the scripts may import from `src/core` is a separate question from whether the domain may duplicate storage.
- Adding a fifth severity, or revisiting SPEC section 3 decision 7. This entry makes one list the only list; it changes no value in it.
- The other value lists named in the DA-13 result (`ROLES`, `SIDES`, `COMMENT_STATUSES`); `grep` finds no second copy of any of them, so there is nothing to close there.
- The comment sweep (DA-58) and the dead-code sweep (DA-59) — neither covers this line, and shortening the comment above `SEVERITY_ORDER` is not a fix for the duplication beneath it.

## Verification

- `grep -rn '"critical", "warning", "nit", "question"' src/` returns one line, in `src/core/storage/types.ts`.
- A test pins `worstSeverity` to `SEVERITIES`, and it turns red when the two lists disagree — the probe is adding a value to `SEVERITIES` (and to `Severity`) without touching the domain, which must fail rather than silently return `null`.
- Gates green on the change: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run test:bun`. The change touches no measured path, but `bun run perf` stays in the set because `countReview` runs per review response.
