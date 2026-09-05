# DA-29.1 · A line anchor's context mixes both sides of the diff

- **Scope:** 04-domain (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** none
- **Taken:** 2026-09-05

## Context

`captureAnchor` slices the hunk's raw line list for the three lines of context
either way, and that list holds both sides of the diff. A comment anchored on
the `new` side therefore keeps `delete` lines — text that is not in the file the
comment is about — in `anchor.before` and `anchor.after`.

`src/core/domain/anchors.ts:91`:

```ts
before: hunk.lines.slice(Math.max(0, index - CONTEXT), index).map((one) => one.content),
after: hunk.lines.slice(index + 1, index + 1 + CONTEXT).map((one) => one.content),
```

Neither slice filters by `side`, while `lineContent` above them is found by
`lineNumber(one, side) === line`.

Observed on the small synthetic review (`bun run scripts/synth.ts --out $FIX
--small`), commenting on the new side of line 16:

```
$ bun src/cli/index.ts comment --repo repos/services/quotes-worker \
    --path src/Cargos/CargoService497.cs --line 16 --severity critical \
    --body "…" --root $FIX
c_qlggx7 opened on repos/services/quotes-worker/src/Cargos/CargoService497.cs:16
```

```json
"anchor": {
  "lineContent": "    private readonly ILogger<ShipmentSet491Resolver> _logger;",
  "hunk": "@@ -10,41 +10,72 @@ public sealed class InvoiceSet471Resolver",
  "before": [
    "public sealed class ShipmentSet491Resolver",
    "{",
    "    private readonly ILogger<InvoiceSet472Resolver> _logger;"
  ],
  "after": [
    "",
    "    public InvoiceSet472 Expand(InvoiceSet472Request request)",
    "    public ShipmentSet491 Resolve(ShipmentSet491Request request)"
  ]
}
```

The third line of `before` and the second of `after` are `delete` lines of the
old side. On the new side lines 13–15 are the doc comment, the class line, and
`{`, and line 17 is empty followed by the `Resolve` signature. The file at
`src/Cargos/CargoService497.cs:13-18` confirms it.

What this costs: `anchor.before` and `anchor.after` are what re-anchoring after
an edit (DA-42) matches against, and what a reader sees when the file has moved
under the comment. Matching a `new`-side comment against text that only ever
existed on the old side fails, and it fails silently.

## Work to do

- Take the context of a line anchor from the lines that exist on the anchored
  side: `context` and `insert` for `new`, `context` and `delete` for `old`.
- A unit test in `tests/` over a hunk that has deletions before and after the
  anchored line.

## Out of scope

- Re-anchoring itself (DA-42, deferred).
- The `hunk` header field, which names the hunk and is correct as it is.

## Verification

- The anchor captured for the case above has the three preceding new-side lines
  in `before` and the three following ones in `after`, and no `delete` line in
  either.
