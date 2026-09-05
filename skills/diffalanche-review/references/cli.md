# diffalanche-review · commands and shapes

Every block below is real output of `diffalanche` on the small synthetic review
(`bun run synth -- --out <dir> --small`): three repositories under `repos/`,
twenty changed files. Long arrays are cut where marked and nowhere else.

## review list — which session you are writing into

```
$ diffalanche review list
* review-demo  head  2 open   0 resolved  3 repositories  Self-review of quotes-worker
  demo         head  3 open   0 resolved  3 repositories  Cargo flags and quotes
  synth        head  17 open  3 resolved  not scanned     Synthetic review
```

The `*` is the current session — the one every command uses without `--review`.
`--json` gives `{"sessions": [...], "warnings": [...]}`, each session with
`name`, `title`, `base`, `createdAt`, `updatedAt`, `current`, `open`,
`resolved`, and `repositories` (`null` when the session has never been scanned).

## diff --json — the change set

```
$ diffalanche diff --repo repos/services/quotes-worker --json
```

```json
{
  "version": 1,
  "base": { "mode": "head" },
  "root": "/…/fixture",
  "repositories": [
    {
      "path": "repos/services/quotes-worker",
      "branch": "main",
      "base": { "mode": "head", "ref": "HEAD", "sha": "16b2b0dd…" },
      "files": [ "…" ],
      "warnings": []
    }
  ],
  "totals": { "repositories": 1, "files": 6, "lines": 617 },
  "warnings": []
}
```

`base.mode` is `head`, `branch`, or `ref`; a repository whose base did not
resolve is out of the review and says so in `warnings`. Every file:

```json
{
  "path": "src/Cargos/CargoService497.cs",
  "oldPath": null,
  "status": "modified",
  "additions": 80,
  "deletions": 19,
  "patch": "diff --git a/src/Cargos/CargoService497.cs …",
  "hunks": [ "…" ],
  "omitted": null
}
```

`status` is `added`, `modified`, `deleted`, or `renamed` — those four and no
others, so an untracked file arrives as `added` like any other new file.
`oldPath` is set on a rename. `omitted` is `null`, `"binary"`, or
`"too-large"` — an omitted file has an empty patch and no hunks, and there is
nothing in it to review.

## hunks — where line numbers come from

```json
{
  "header": "@@ -10,41 +10,72 @@ public sealed class InvoiceSet471Resolver",
  "lines": [
    { "type": "context", "content": "        return new InvoiceSet471(invoices);", "oldLine": 10, "newLine": 10 },
    { "type": "delete",  "content": "public sealed class InvoiceSet472Resolver",   "oldLine": 14, "newLine": null },
    { "type": "insert",  "content": "public sealed class ShipmentSet491Resolver",  "oldLine": null, "newLine": 14 },
    { "type": "insert",  "content": "    private readonly ILogger<ShipmentSet491Resolver> _logger;", "oldLine": null, "newLine": 16 }
  ]
}
```

`newLine` is what `--line` takes with the default `--side new`; `oldLine` is
what it takes with `--side old`. A line that is `null` on the side you asked for
is not on that side, and `comment` refuses it:

```
$ diffalanche comment --repo repos/services/quotes-worker \
    --path src/Cargos/CargoService497.cs --line 9000 --severity nit --body "…"
diffalanche: line 9000 of repos/services/quotes-worker/src/Cargos/CargoService497.cs is not in the change set on the new side; the nearest hunk is @@ -10,41 +10,72 @@ public sealed class InvoiceSet471Resolver
```

Exit code 1, nothing written.

## comment — opening a finding

```
$ diffalanche comment --repo repos/services/quotes-worker \
    --path src/Cargos/CargoService497.cs --line 16 \
    --severity critical --author claude --role agent --body - <<'BODY'
_logger is readonly and nothing ever assigns it: ShipmentSet491Resolver has no
constructor, so Resolve throws NullReferenceException on the LogDebug five lines
down. Take ILogger<ShipmentSet491Resolver> in a constructor.
BODY
c_qlggx7 opened on repos/services/quotes-worker/src/Cargos/CargoService497.cs:16
```

The id is the first word of the line, so a script reads it with
`cut -d' ' -f1`. Dropping `--line` anchors to the file, dropping `--path` to the
repository, dropping `--repo` to the whole review:

```
$ diffalanche comment --repo repos/services/quotes-worker \
    --path src/Cargos/CargoService497.cs \
    --severity warning --author claude --role agent --body "…"
c_ytmc7j opened on repos/services/quotes-worker/src/Cargos/CargoService497.cs
```

A repository the scan does not find is exit code 1 before anything is read or
written:

```
$ diffalanche comment --repo repos/core/nope --severity nit --body x
diffalanche: --repo: no repository "repos/core/nope" under the root
```

A body that is only whitespace is exit code 1 as well, from `--body -` as much
as from `--body <text>`.

## What the comment looks like on disk

```
$ diffalanche list --severity critical --json
```

```json
[
  {
    "id": "c_qlggx7",
    "repo": "repos/services/quotes-worker",
    "path": "src/Cargos/CargoService497.cs",
    "side": "new",
    "line": 16,
    "endLine": null,
    "anchor": {
      "lineContent": "    private readonly ILogger<ShipmentSet491Resolver> _logger;",
      "hunk": "@@ -10,41 +10,72 @@ public sealed class InvoiceSet471Resolver",
      "before": ["public sealed class ShipmentSet491Resolver", "{", "    private readonly ILogger<InvoiceSet472Resolver> _logger;"],
      "after": ["", "    public InvoiceSet472 Expand(InvoiceSet472Request request)", "    public ShipmentSet491 Resolve(ShipmentSet491Request request)"]
    },
    "severity": "critical",
    "status": "open",
    "author": "claude",
    "role": "agent",
    "body": "_logger is readonly and nothing ever assigns it: …",
    "createdAt": "2026-09-05T11:55:55.158Z",
    "resolvedAt": null,
    "resolvedBy": null,
    "replies": []
  }
]
```

`repo`, `path`, `line`, and `endLine` are `null` down to whichever level the
comment was opened at. The `anchor` is filled by the tool, not by you: it reads
the repository again so the anchor points at the line that is there now.

Today `anchor.before` and `anchor.after` are taken from the hunk without
filtering by side, so a `new`-side anchor can carry lines the change removed —
the third entry of `before` above is one. It is a known defect of the anchor
capture, not something a finding you write can avoid.

Without `--json`, the same list is one line per comment:

```
$ diffalanche list
c_qlggx7  critical  open  repos/services/quotes-worker/src/Cargos/CargoService497.cs:16  claude  _logger is readonly and nothing ever assigns it: …
c_ytmc7j  warning   open  repos/services/quotes-worker/src/Cargos/CargoService497.cs     claude  The same shape repeats across the whole file: …
```

## What is refused

```
$ diffalanche resolve c_qlggx7
diffalanche: only a human may resolve a comment; this call came with role "agent"
```

Exit code 1, nothing changed — with the default role and with an explicit
`--role agent` alike. `reopen` is the same. Do not work around it by passing
`--role human`.
