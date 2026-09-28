#!/bin/bash
# A cloud session gets what the gates need; a step the network refuses warns and the session goes on.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 0
# What a SessionStart hook prints to stdout becomes the session's context; the log is not.
exec >&2

warn() { echo "session-start: $1 failed; see README.md, \"Cloud sessions\""; }

# The Bun every pinned CI job runs, read from ci.yml so the two cannot drift.
want=$(grep -m1 -oE 'bun-version: [0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml | awk '{print $2}') || want=""
if [ -z "$want" ]; then
  warn "reading the Bun version from ci.yml"
elif [ "$(bun --version 2>/dev/null)" != "$want" ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$want/bun-linux-x64.zip" \
    && unzip -oq "$tmp/bun.zip" -d "$tmp" \
    && mkdir -p "$HOME/.bun/bin" && install -m 755 "$tmp/bun-linux-x64/bun" "$HOME/.bun/bin/bun"
  rm -rf "$tmp"
  [ "$(bun --version 2>/dev/null)" = "$want" ] || warn "Bun $want (another bun is first on PATH, or the download)"
fi

bun install --frozen-lockfile || warn "bun install"
# The lockfile's Playwright, not the latest: a browser built for another one fails every launch.
./node_modules/.bin/playwright install chromium-headless-shell || warn "the Playwright browser"
bun run model:fetch || warn "the embedding model"
# The backslop adapters are generated per checkout and gitignored; lint needs them.
cli=$(node -p 'require("./backslop.json").cli') && ${cli/#npx /npx --yes } init >/dev/null || warn "backslop init"
exit 0
