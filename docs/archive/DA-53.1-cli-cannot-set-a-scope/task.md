# DA-53.1 · The CLI cannot give a scope to a session that has none, while the HTTP route replaces one outright

- **Scope:** 06-cli, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-10
- **Dependencies:** none
- **Taken:** 2026-09-18

## Context

Found while implementing DA-53, and named by the worker rather than decided by it.

A session without a scope is the whole root. `review scope add` widens a scope, and nothing is wider than the whole root, so on such a session it refuses by name — which is right, and `docs/reference/06-cli.md` says so.

But `PUT /api/sessions/:name/scope`, which DA-53 added for the scope editor of DA-55, does not widen: it **replaces**. Over that route a session that had no scope gets one. So the same operation exists on one side of the product and not on the other: a human with the editor can narrow an existing review into a task, and an agent at the CLI cannot — its only route to a scoped task is `review new`.

Whether that asymmetry matters is a product question, not a defect report. The agent protocol says an agent proposes a task with `review new --no-use` and names its own with `--review`, so it never needs to narrow one it already has. The gap is felt by a person at the terminal, and that person has the UI.

The related question the same work raised, and the one that is squarely the owner's: **should a scope follow a rename?** Today it does not — a renamed file is at a path the scope does not name, so the task stops showing it, and the new name is added with `review scope add`. That is decisions 2 and 5 of [ADR-010](../../adr/adr-010-review-task-scope.md) applied literally, and the alternative was measured and rejected during DA-53's review round: resolving renames on read means reading the change set on every read of the comments, and it stops working the moment the rename is committed. If the scope should instead move with `git mv`, that is a different mechanism — the scope written at the moment the rename is noticed — and its own task.

## Work to do

- Decide whether the CLI needs a way to set a scope on an existing session. If it does, the command is a replacement rather than a widening, and it narrows, so it needs the consent flag `review scope remove` already has — a session that becomes scoped hides comments that were readable a moment ago.
- Decide whether a scope follows a rename. If it should, the mechanism is a write at the moment the rename is seen, not a resolution at read time; write down which, because the read-time version has already been tried and rejected with evidence.
- Whichever way both go, `docs/reference/06-cli.md` and `docs/reference/07-server.md` should point at each other here: today each describes its own half and neither says the other side differs.

## Out of scope

- The scope editor itself (DA-55), which is the UI half of the first question.

## Verification

- `docs/reference/06-cli.md` and `07-server.md` agree about what each side can do to a scope, and a reader of either learns that the other differs.
- If a CLI command is added: giving a scope to a session that had none refuses without consent while comments would fall outside it, and names how many — the same shape `review scope remove` has.
