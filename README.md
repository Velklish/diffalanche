# diffalanche

A local code-review tool for a folder that holds many independent git repositories. It shows the changes of every repository under one root as a single merge-request-style review, stores review comments on disk as plain JSON, and gives coding agents a CLI to read comments, reply to them, and open their own.

**Status:** in development. Requirements are approved, the UI is designed, and the work is cut into tasks; the package builds and tests but has no product code yet.

| Document | What it is |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Product specification: base modes, on-disk format, CLI, agent protocol, performance budgets |
| [docs/design/HANDOFF.md](docs/design/HANDOFF.md) | UI design handoff: tokens, screens, interactions, keyboard map (Russian) |
| [docs/design/prototype.dc.html](docs/design/prototype.dc.html) | Working HTML prototype of every screen and state |
| [docs/README.md](docs/README.md) | Documentation index: reference, glossary, roadmap, decisions, backlog |
| [PRODUCT.md](PRODUCT.md) | Durable product truth for design work: users, purpose, positioning, constraints |
| [DESIGN.md](DESIGN.md) | The visual system as `src/ui/tokens.css` implements it, both themes |


## Development

Bun is the toolchain; the server and the CLI run on Node >= 22 as well and use
only APIs shared by both runtimes.

```sh
bun install        # dependencies and the lockfile
bun run lint       # Biome: lint and format check
bun run typecheck  # tsc over the three TypeScript projects
bun run test       # Vitest
bun run test:ui    # Playwright: the UI against its screenshot baselines
bun run build      # both delivery channels: dist/cli.js and six binaries
bun run build:cli  # the npm bundle alone
bun run build:ui   # build the UI into dist/ui with Vite
```

The performance harness measures the UI on the synthetic review in headless
Chromium. It needs the fixture, the built UI, and Chromium once:

```sh
bunx playwright install chromium
bun run synth -- --out .perf/fixture
bun run build:ui
bun run perf         # the gate: medians against the budgets
bun perf/run.ts      # one run, raw numbers
```

`bun run perf` is a gate: it fails when the median of any budget line of the
specification is over budget. It takes about half a minute.

`bun run test:ui` builds the UI, generates the small synthetic review
(`synth -- --out .perf/e2e --small`) and serves it: the diff and navigation
tests run against that fixture, and only the shell tests stub an empty review to
measure the shell on its own. It needs Chromium, the same one the performance
harness uses. The baselines are per platform and the ones in the repository were
taken on macOS.

`bun run typecheck` checks three TypeScript projects in one command: the runtime
code without the browser's globals, `src/ui` without Node's, and the tests and
harnesses with both.

`bun run dev` runs the CLI from source. The same lint, typecheck, and test
commands run in CI on pushes to `main` and on pull requests. Biome skips `backslop.json`:
the backslop CLI rewrites that file in its own style, so formatting it here
would only make the two tools fight.

Layout: `src/core` (scanner, git, storage, domain), `src/cli`, `src/server`,
`src/ui`, `perf` (the performance harness), `scripts` (build and fixture
scripts), `skills` (shipped agent skills). Only `scripts` and `perf` may use
runtime-specific APIs such as `Bun.*`; `src/server/runtime.ts` is the single
place in `src/` that knows which runtime it is on.

### Design artifacts and the design hook

UI work runs against the Impeccable design skill, installed at the Claude Code
user level (`~/.claude/skills/impeccable`). It reads four files in this
repository:

| File | What it is |
|---|---|
| `PRODUCT.md` | Durable product truth: users, purpose, positioning, constraints, brand commitments. Written once; it changes when the product does, not when a screen does. |
| `DESIGN.md` | The visual system as `src/ui/tokens.css` implements it, both themes, in the [DESIGN.md format](https://github.com/google-labs-code/design.md). The token authority beside the handoff; its colours and `tokens.css` carry the same values and change in the same pass. |
| `.impeccable/design.json` | What that format cannot hold: the two shadows, the two keyframes, the focus rings, the 1560 px floor, colour display names, and eight component snippets. |
| `.impeccable/surfaces/*.md` | One brief per screen — scope, visitor mode, the job, constraints, and what is still unresolved there. `src-ui-app-tsx.md` covers the review workspace and every component in it. |

Before editing anything under `src/ui`, load them together:

```sh
node ~/.claude/skills/impeccable/scripts/context.mjs --target src/ui/App.tsx
```

The **design detector hook** runs the same checks automatically after an editing
tool writes a UI file, and a deeper pass over everything the session touched when
it stops. `.impeccable/config.json` turns it on for this repository and is
committed; `.impeccable/config.local.json` records one developer's consent and is
not.

No harness manifest is committed, because a manifest has to name the path where
Impeccable is installed and that path differs per machine. Each developer wires
it once:

```sh
node ~/.claude/skills/impeccable/scripts/hook-admin.mjs on      # installs manifests
node ~/.claude/skills/impeccable/scripts/hook-admin.mjs status  # what is wired now
```

`on` writes the manifests only when the skill sits inside the project
(`.claude/skills/impeccable`, `.agents/skills/impeccable`,
`.cursor/skills/impeccable`). With a user-level install it enables the hook in
`.impeccable/config.json` and prints *"No installed provider skill folders found
to repair"* — then the manifest is added by hand. Replace
`$HOME/.claude/skills/impeccable` below with wherever the skill actually lives.

Claude Code, `.claude/settings.local.json` (gitignored):

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 5, "statusMessage": "Checking UI changes" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 30, "statusMessage": "Design deep pass" }] }
    ]
  }
}
```

Codex, `.codex/hooks.json` — the same two events, a different write matcher, and
approval through `/hooks` the first time:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|apply_patch",
        "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 5, "statusMessage": "Checking UI changes" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook.mjs\"", "timeout": 30, "statusMessage": "Design deep pass" }] }
    ]
  }
}
```

Cursor, `.cursor/hooks.json` — a pre-write gate instead, which refuses a proposed
write the detector objects to; enable hooks under Settings → Hooks:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      { "command": "node \"$HOME/.claude/skills/impeccable/scripts/hook-before-edit.mjs\"", "timeout": 5 }
    ]
  }
}
```

Without a hook the check is manual, once, on the files a change touched:

```sh
node ~/.claude/skills/impeccable/scripts/detect.mjs --json src/ui/App.tsx src/ui/styles.css
```

License: MIT.
