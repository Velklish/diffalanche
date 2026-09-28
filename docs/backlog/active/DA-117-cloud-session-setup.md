# DA-117 · A cloud session sets itself up, and the design skill's commands are its launcher's

- **Scope:** 11-perf, 08-ui (see [reference](../../reference/README.md)); README, "Design artifacts and the design hook" and "Cloud sessions"
- **Created:** 2026-09-28
- **Dependencies:** none
- **Taken:** 2026-09-28

## Context

DA-82 ran in a Claude Code on the web container and lost about a quarter of an
hour to its setup, and part of its verification to it: the container's Bun was
1.3.11 against CI's 1.3.14, Playwright 1.63 looked for a headless shell of a
build the container did not have ("Executable doesn't exist at
/opt/pw-browsers/chromium_headless_shell-1243/…"), `bun run model:fetch` was
answered 403 by the network policy, a fresh checkout has none of the gitignored
backslop adapters `backslop lint` checks for, and the Impeccable skill was not
installed. The skill, cloned at its current release, has no
`scripts/context.mjs`: `AGENTS.md` and README name `node scripts/*.mjs` entry
points that its launcher (`scripts/impeccable <verb>`) replaced. And the base of
`main` is over five perf budgets on that container, where the reference's rule
for a red "the machine caused" reads every run as the base's and cannot tell a
branch's regression from the machine. The owner asked for everything
that can be fixed in the repository to be fixed, with no local permission in it.

## Work to do

- A SessionStart hook that sets up a cloud session and does nothing elsewhere.
- README and `AGENTS.md` on the launcher's verbs; README's "Cloud sessions": what
  the hook does, the domains to allow, and the environment's own setup lines.
- 11-perf: the verdict on a machine the base is over budget on.

## Out of scope

- The environment's settings themselves, which are the owner's.
- The `chmod` test under root (DA-117.1) and `e2e/history.spec.ts` in the container (DA-116).

## Verification

- `CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh` exits 0, prints nothing
  on stdout, and warns on stderr for every step it cannot reach; without
  `CLAUDE_CODE_REMOTE` it exits 0 at once.
- `grep -rn "context.mjs\|hook.mjs\|hook-admin.mjs\|detect.mjs" README.md AGENTS.md`
  finds nothing.
- `.claude/settings.json` carries the hook and no `permissions`.
