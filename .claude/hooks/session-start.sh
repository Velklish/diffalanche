#!/bin/bash
# A cloud session gets what the gates need; a step the network refuses warns and the session goes on.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR"

warn() { echo "session-start: $1 failed; see README.md, \"Cloud sessions\"" >&2; }

# The Bun every pinned CI job runs, read from ci.yml so the two cannot drift.
want=$(grep -m1 -oE 'bun-version: [0-9]+\.[0-9]+\.[0-9]+' .github/workflows/ci.yml | awk '{print $2}')
if [ "$(bun --version 2>/dev/null || true)" != "$want" ]; then
  tmp=$(mktemp -d)
  if curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$want/bun-linux-x64.zip" \
    && unzip -oq "$tmp/bun.zip" -d "$tmp"; then
    mkdir -p "$HOME/.bun/bin" && install -m 755 "$tmp/bun-linux-x64/bun" "$HOME/.bun/bin/bun"
  else
    warn "Bun $want"
  fi
  rm -rf "$tmp"
fi

bun install --frozen-lockfile || warn "bun install"
# The headless shell of the Playwright the lockfile pins, where PLAYWRIGHT_BROWSERS_PATH points.
bunx playwright install chromium-headless-shell || warn "the Playwright browser"
bun run model:fetch || warn "the embedding model"
# The backslop adapters are generated per checkout and gitignored; lint needs them.
cli=$(bun -e 'console.log(require("./backslop.json").cli)')
${cli/#npx /npx --yes } init >/dev/null || warn "backslop init"
