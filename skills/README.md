# skills

Agent skills shipped with diffalanche. The CLI is the only contract they use
([`docs/SPEC.md`](../docs/SPEC.md) section 9); the HTTP API is for the UI and is
not a contract.

| Skill | What it does |
|---|---|
| [diffalanche-apply](diffalanche-apply/SKILL.md) | Reads the unanswered threads, groups them by repository, gets the human's confirmation, edits the code, and replies to every comment |
| [diffalanche-review](diffalanche-review/SKILL.md) | Reads the change set and opens findings as comments anchored to the lines that carry them |

Neither closes a thread: `resolve` and `reopen` need `--role human` and refuse
anything else ([ADR-004](../docs/adr/adr-004-agent-contract.md)).

Each skill is a `SKILL.md` — frontmatter with `name` and a `description` that
carries its triggers, then the procedure — beside a `references/cli.md` with the
commands and the JSON shapes as the CLI really prints them. Installing them into
a harness is in the [README](../README.md#agent-skills); how they are shipped
and what they promise is in
[docs/reference/10-skills.md](../docs/reference/10-skills.md).
