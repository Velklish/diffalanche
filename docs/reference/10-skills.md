# 10 · Shipped agent skills

`skills/` holds the two agent skills diffalanche ships. They are the written
half of the agent protocol of `docs/SPEC.md` section 9; the enforced half is the
CLI itself, which is the only contract an agent works through
([ADR-004](../adr/adr-004-agent-contract.md)).

| Skill | What it does | Files |
|---|---|---|
| `diffalanche-apply` | Reads the unanswered threads, groups them by repository, gets the human's confirmation, edits the code, replies to every comment | `SKILL.md`, `references/cli.md` |
| `diffalanche-review` | Reads the change set and opens findings as comments anchored to the lines that carry them | `SKILL.md`, `references/cli.md` |

## Format

Each skill is a directory with a `SKILL.md` in the Agent Skills format:
frontmatter with `name` and a `description` that carries the triggers a harness
matches on, then the procedure as prose. Beside it, `references/cli.md` holds
the commands and the JSON shapes as the CLI really prints them — captured from a
run on the small synthetic review (`bun run synth -- --out <dir> --small`), not
written from the specification. A shape that drifts from the CLI is a defect in
the skill, and the way to fix it is to run the command again.

Nothing else is in the frontmatter. `allowed-tools` would pin the skills to one
harness's permission model, and a `version` would be a second number to keep in
step with the package's own.

## What the procedures fix

Both skills say the same three things, because all three are places an agent
gets it wrong on its own:

- **The session.** `list`, `diff`, and `comment` all work on the current session
  when `--review` is absent, and a root holds several. Both procedures start at
  `review list`, where `*` marks the current one.
- **The gate.** `diffalanche-apply` presents its plan and stops. Edits are not
  versioned by diffalanche — the tool never writes to a reviewed repository — so
  a misread comment costs an edit nobody asked for, in a working tree the human
  may not have committed.
- **The refusal.** Neither skill calls `resolve` or `reopen`, and both say not
  to reach for `--role human` when the CLI refuses. The refusal is the domain's,
  not the skill's, so an agent that never read a skill cannot close a thread
  either; the skills exist so an agent does not spend a turn discovering that.

Reply rules are `docs/SPEC.md` section 9: one or two sentences when the issue is
fixed, the full reasoning when the agent declines. Several agents on one session
narrow with `--repo` and sign with their own `--author`; the session's lock lets
their writes interleave without losing a message.

## How they are shipped

`package.json` lists `skills` in `files` beside `dist`, so the markdown is
published as it stands and `npm install diffalanche` puts it in
`node_modules/diffalanche/skills/`. Bare `npx diffalanche` does not: it runs the
CLI out of a cache directory with no path a reader can copy from, so a clone or
an install is what puts the skills within reach. The alternative was to bundle
the skills
into `dist` and let `scripts/build.ts` rewrite paths and version strings into
them; nothing in the text needs rewriting today, and a build step between the
file a contributor edits and the file an agent reads is a way for the two to
disagree. If a later release does need a version string in a skill, that build
step is the change to make, and the release pipeline (DA-31) owns it.

```
$ npm pack --dry-run
npm notice Tarball Contents
npm notice  1.1kB LICENSE
npm notice 11.8kB README.md
…                                              dist/ui, eight files, cut here
npm notice  1.5kB package.json
npm notice  5.7kB skills/diffalanche-apply/references/cli.md
npm notice  7.5kB skills/diffalanche-apply/SKILL.md
npm notice  6.9kB skills/diffalanche-review/references/cli.md
npm notice  6.6kB skills/diffalanche-review/SKILL.md
npm notice  1.1kB skills/README.md
```

`dist/` is there only when the UI has been built; `dist/cli.js` joins it after
`bun run build`. The sizes are a snapshot, not a promise — what the block shows
is that all five files of `skills/` are in the tarball and that nothing else of
the repository is.

Installing them into a harness — Claude Code's `.claude/skills/`, or a manifest
that points at the files where they lie — is in the
[README](../../README.md#agent-skills). Adapters for Cursor and Codex are a
separate, deferred task.
