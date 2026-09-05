# DA-35 · suggest command and API

- **Order:** 350
- **Scope:** 09-ml, 06-cli, 07-server (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-34

## Context

`docs/SPEC.md` section 8: `suggest --body <text> [--json]` returns similar past comments and a likely severity; section 3, decision 10: no fine-tuning — "in your style" is retrieval of past comments.

## Work to do

- `src/core/ml/suggest`: embed the text, take the k nearest comments across sessions, return them with similarity and source (session, file, line); severity proposal by weighted vote of the neighbours with a confidence.
- CLI `suggest` and `GET /api/suggest?body=` for the composer; results within 100 ms after the model is warm.

## What Phase 1 changed

Phase 1 fixed the CLI as the agent contract. A new command is added to `src/cli` through `run()`, and `tests/readme-cli.test.ts` fails until the README's CLI table names it with its flags; the two agent skills (DA-29) read `references/cli.md`, which must learn `suggest` too. Server routes live in `src/server/app.ts` and refuse with the shared `ErrorBody` shape; the HTTP API is not a contract (decision 9). The UI's copies of server shapes are checked at the type level by `tests/ui-wire.test.ts`.

## Out of scope

- The composer UI (DA-36).

## Verification

- On the synthetic review with clustered comment texts, `suggest` for a paraphrase returns a comment of the same cluster first and proposes its severity.
- Response time measured in a test stays under 100 ms for a warm model.

