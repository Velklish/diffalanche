# diffalanche-apply · commands and shapes

Every block below is real output of `diffalanche` on the small synthetic review
(`bun run synth -- --out <dir> --small`) with three comments written by a human
across two repositories. Long bodies are cut where marked and nowhere else.

## review list — which session you are answering

```
$ diffalanche review list
  cargo-flags  head  open  0 open   0 resolved  not scanned     scope: repos/core/cargos-api, repos/platform/loads-search (app/cargo/cargo_404.py)  Кэш тарифов: правки агента
* synth        head  open  17 open  3 resolved  3 repositories  scope: the whole root                                                               Synthetic review
```

The `*` is the current session. Every command below uses it unless you pass
`--review cargo-flags`. The columns after the base are the status, the comment
counters, the repositories of the last scan, and the scope — what the task is
about, or the whole root when it is about everything.

```
$ diffalanche review scope --review cargo-flags
repos/core/cargos-api        the whole repository
repos/platform/loads-search  app/cargo/cargo_404.py
```

A task answers inside that scope and your writes stay inside it too.

## list --unanswered --json — the work

```
$ diffalanche list --unanswered --json
```

```json
[
  {
    "id": "c_eft2jg",
    "repo": "repos/core/cargos-api",
    "path": "src/Payloads/PayloadService215.cs",
    "side": "new",
    "line": 22,
    "endLine": null,
    "anchor": {
      "lineContent": "        _logger.LogDebug(\"collectd {Count} vehicles\", vehicles.Length);",
      "hunk": "@@ -0,0 +1,111 @@",
      "before": [
        "    public VehicleSet201 Collect(VehicleSet201Request request)",
        "    {",
        "        var vehicles = request.Vehicles ?? Array.Empty<Vehicle201>();"
      ],
      "after": [
        "        return new VehicleSet201(vehicles);",
        "    }",
        "}"
      ]
    },
    "severity": "nit",
    "severitySource": "auto",
    "status": "open",
    "author": "kim.p",
    "role": "human",
    "body": "Typo in the log message: \"collectd\" should be \"collected\".",
    "createdAt": "2026-09-05T11:52:55.645Z",
    "resolvedAt": null,
    "resolvedBy": null,
    "replies": []
  }
]
```

Two more entries follow in the same shape:
`c_j6v2hl` — `warning` on `repos/core/cargos-api/src/route/route-200.ts:61`, and
`c_086mw5` — `critical` on
`repos/platform/loads-search/internal/quote/quote-417.go:5`.

Fields you act on:

| Field | What it means to you |
|---|---|
| `repo` | path relative to the root; the file is `<root>/<repo>/<path>` |
| `path`, `line`, `endLine`, `side` | `null` down to the level the comment was written at: a comment with `repo` and no `path` is about the whole repository, one with no `repo` about the whole review |
| `anchor.lineContent` | the line as it was when the comment was written — compare it with the file before you edit |
| `anchor.before`, `anchor.after` | three lines of context each way, from the side the comment is on |
| `severity` | `critical`, `warning`, `nit`, `question` — the order you work in |
| `severitySource` | who chose `severity`: `manual` the writer; `auto` the tool, from similar past comments, waiting for an agent to agree; `confirmed:<author>` an agent already did |
| `role` | `human` or `agent`; `--unanswered` means the last message is `human` |
| `replies` | the rest of the thread, oldest first |

Without `--json` the same list is one line per comment, which is what you show a
human:

```
$ diffalanche list --unanswered
c_eft2jg  nit       open  repos/core/cargos-api/src/Payloads/PayloadService215.cs:22  kim.p  Typo in the log message: "collectd" should be "collected".
c_j6v2hl  warning   open  repos/core/cargos-api/src/route/route-200.ts:61             kim.p  filter(Boolean) does not narrow the element type, so CargoSet187 …
c_086mw5  critical  open  repos/platform/loads-search/internal/quote/quote-417.go:5   kim.p  NormalizeInvoices404 returns the package-level defaultInvoiceSet404 …
```

## show — one thread

```
$ diffalanche show c_eft2jg --json
```

The same object as one entry of `list --json`. Use it for a comment id the human
named, or when you want one thread on its own.

## reply — one per comment

A one-liner when the fix is small:

```
$ diffalanche reply c_eft2jg \
    --body 'Fixed: the log message now reads "collected {Count} vehicles".' \
    --author claude --role agent
r_1 added to c_eft2jg
```

`--body -` for anything with a newline in it — here a decline, three sentences
at the most, as the skill's reply rules require:

```
$ diffalanche reply c_j6v2hl --author claude --role agent --body - <<'BODY'
The retry stays: the 502 comes from the upstream balancer, not from our client,
and one retry is what the SLA assumes. Removing it moves the failure to every
caller instead of one place. A trace showing the retry masking a real fault
would change this.
BODY
r_1 added to c_j6v2hl
```

When `severitySource` is `auto` the human left the severity to the tool, and
your reply can agree with it — only when you do, after reading the finding:

```
$ diffalanche reply c_eft2jg --author claude --role agent --confirm-severity \
    --body 'Fixed: the log message now reads "collected {Count} vehicles".'
r_1 added to c_eft2jg, severity nit confirmed
```

`severitySource` is then `confirmed:claude`, and the thread reads `labelled by
claude`. On a comment whose `severitySource` is not `auto` the flag is refused
with exit code 1 and nothing is written — the reply neither — so drop the flag
and send the reply again.

The reply's id is the first word of the line. The thread afterwards:

```json
"replies": [
  {
    "id": "r_1",
    "author": "claude",
    "role": "agent",
    "body": "Fixed: the log message now reads \"collected {Count} vehicles\".",
    "createdAt": "2026-09-05T11:58:12.453Z"
  }
]
```

The comment's own `status` stays `open` and `resolvedAt` stays `null`: a reply
answers a thread, it does not close it.

## Checking yourself

```
$ diffalanche list --unanswered --json
[]
```

Every thread in the plan has your reply on it. The comments are still open,
which is what a human verifying them expects:

```
$ diffalanche list --status resolved
no comments match
```

## What is refused

```
$ diffalanche resolve c_eft2jg
diffalanche: only a human may resolve a comment; this call came with role "agent"
```

Exit code 1, nothing changed — with the default role and with an explicit
`--role agent` alike. `reopen` is the same, and so are `review close` and
`review reopen`, which mark the whole task:

```
$ diffalanche review close cargo-flags
diffalanche: only a human may close a review task; this call came with role "agent"
```

Do not work around any of them by passing `--role human`. A closed task is not
locked, so nothing else here changes when the human closes one: `reply` still
lands, and `list --unanswered` still answers.

## Narrowing for several agents

```
$ diffalanche list --unanswered --repo repos/core/cargos-api --json
```

`list --repo` is checked against the repositories the session's comments name,
not the file system. A repository nobody has commented on is exit code 1:

```
$ diffalanche list --repo repos/services/quotes-worker
diffalanche: --repo: no comment in this review session is on "repos/services/quotes-worker"
```

A repository that was renamed or deleted still answers, because `list` is the
only way to read back what was said about it.
