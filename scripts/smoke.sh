#!/bin/sh
#
# One review through one delivery channel, end to end: the scenario the smoke
# matrix of [ADR-006](../docs/adr/adr-006-verification.md) runs on every runtime.
# The channel is the command this script is given.
#
#   scripts/smoke.sh node dist/cli.js
#   scripts/smoke.sh bun src/cli/index.ts
#   scripts/smoke.sh ./dist/diffalanche-darwin-arm64
#
# Run it from the repository root: the fixture comes from `bun run synth` and
# the command is taken as it is typed, so its paths are the ones a person would
# type there. The words of the command must not contain spaces — a POSIX shell
# has one list, the positional parameters, and they carry the arguments.
#
# Everything is written under a temporary root that is removed on the way out;
# no repository of the checkout is read or written. See
# [docs/reference/11-perf.md](../docs/reference/11-perf.md).

set -u

usage() {
    cat <<'EOF'
usage: scripts/smoke.sh <command> [<argument>...]

  scripts/smoke.sh node dist/cli.js
  scripts/smoke.sh bun src/cli/index.ts
  scripts/smoke.sh ./dist/diffalanche-darwin-arm64
EOF
}

case "${1:-}" in
    "") usage >&2; exit 1 ;;
    -h | --help) usage; exit 0 ;;
esac

CLI="$*"
SERVER_PID=
WORK=

# What the scenario writes, so a failure can print it back.
STDOUT=
STDERR=
LAST_COMMAND=
STEP=

# The answer of the last read_json, and how many rows it had.
QUERY_OUT=
QUERY_ROWS=0

fail() {
    printf '\nsmoke: %s\n' "$1" >&2
    exit 1
}

# A file quoted back into the failure, indented, empty said out loud: a step
# that failed with nothing on stderr is a different fault from one that failed
# with a message, and a blank block hides which it was.
quote() {
    if [ -s "$1" ]; then
        sed 's/^/    /' "$1" >&2
    else
        printf '    (empty)\n' >&2
    fi
}

require() {
    command -v "$1" >/dev/null 2>&1 || fail "$1 is not on PATH; $2"
}

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null
        wait "$SERVER_PID" 2>/dev/null
    fi
    [ -n "$WORK" ] && rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[ -f package.json ] && [ -f scripts/synth.ts ] ||
    fail "run this from the repository root: the fixture comes from \`bun run synth\`"

require bun "the synthetic review is generated with \`bun run synth\`"
require curl "the running server is asked for the review over HTTP"

# `jq` where there is one, a small Node script where there is not: a Windows
# runner has Node before it has jq.
if command -v jq >/dev/null 2>&1; then
    JSON=jq
elif command -v node >/dev/null 2>&1; then
    JSON=node
else
    fail "neither jq nor node is on PATH; one of them reads the JSON back"
fi

WORK=$(mktemp -d 2>/dev/null || mktemp -d -t diffalanche-smoke) || fail "no temporary directory"
ROOT="$WORK/root"
STDOUT="$WORK/stdout"
STDERR="$WORK/stderr"
SERVE_OUT="$WORK/serve.out"
SERVE_ERR="$WORK/serve.err"
mkdir "$ROOT" || fail "cannot create $ROOT"

# The three questions the scenario asks of a JSON output. Both readers answer
# them the same way: one line per row, columns separated by tabs.
jq_program() {
    case "$1" in
        anchor)
            printf '%s' '.repositories[0] as $r
                | first($r.files[] | select(any(.hunks[]?.lines[]?; .type == "insert"))) as $f
                | first($f.hunks[].lines[] | select(.type == "insert") | .newLine) as $l
                | [$r.path, $f.path, $l] | @tsv'
            ;;
        totals) printf '%s' '[.totals.repositories, .totals.files, .totals.lines] | @tsv' ;;
        comments)
            printf '%s' '(if type == "array" then . else .comments end)[]
                | [.id, .status, .severity, (.repo // ""), (.path // ""), (.line // ""),
                   .author, (.replies | length)] | @tsv'
            ;;
        *) fail "unknown query $1" ;;
    esac
}

if [ "$JSON" = node ]; then
    cat >"$WORK/smoke-json.mjs" <<'MJS'
// The queries of scripts/smoke.sh, for a machine without jq.
import { readFileSync } from "node:fs";

const [name, file] = process.argv.slice(2);
const value = JSON.parse(readFileSync(file, "utf8"));
const row = (cells) => console.log(cells.join("\t"));
const insert = (line) => line.type === "insert";

if (name === "anchor") {
  const repo = value.repositories[0];
  const changed = repo.files.find((file) => file.hunks.some((hunk) => hunk.lines.some(insert)));
  const line = changed.hunks.flatMap((hunk) => hunk.lines).find(insert);
  row([repo.path, changed.path, line.newLine]);
} else if (name === "totals") {
  row([value.totals.repositories, value.totals.files, value.totals.lines]);
} else if (name === "comments") {
  for (const comment of Array.isArray(value) ? value : value.comments) {
    row([
      comment.id,
      comment.status,
      comment.severity,
      comment.repo ?? "",
      comment.path ?? "",
      comment.line ?? "",
      comment.author,
      comment.replies.length,
    ]);
  }
} else {
  console.error(`smoke-json: unknown query ${name}`);
  process.exit(1);
}
MJS
fi

# Reads one query and leaves the answer in QUERY_OUT, its line count in
# QUERY_ROWS. It is a function rather than a value in a substitution because a
# substitution runs in a subshell, where an `exit` ends the subshell and the
# scenario walks on.
#
# No rows and a reader that broke are different answers. `jq -e` exits 4 when
# the filter produced no output at all — an empty comment list — and 2, 3, or 5
# when the input or the filter itself was wrong; the Node reader writes nothing
# and exits 0 for an empty list, non-zero when it throws. Without the
# difference, a `jq` that cannot parse the JSON satisfies every expectation of
# zero comments.
read_json() { # <query> <file>
    if [ "$JSON" = jq ]; then
        QUERY_OUT=$(jq -er "$(jq_program "$1")" "$2" 2>"$WORK/reader.err")
        code=$?
        [ "$code" -eq 4 ] && code=0
    else
        QUERY_OUT=$(node "$WORK/smoke-json.mjs" "$1" "$2" 2>"$WORK/reader.err")
        code=$?
    fi
    if [ "$code" -ne 0 ]; then
        printf '\nsmoke: the %s query over %s failed\n' "$1" "$2" >&2
        printf '  reader     %s\n' "$JSON" >&2
        printf '  exit code  %s\n' "$code" >&2
        printf '  stderr:\n' >&2
        quote "$WORK/reader.err"
        exit 1
    fi
    if [ -z "$QUERY_OUT" ]; then
        QUERY_ROWS=0
    else
        QUERY_ROWS=$(printf '%s\n' "$QUERY_OUT" | wc -l | tr -d ' ')
    fi
}

# One command of the channel under test. Its output is kept for the assertions
# that follow it, and a non-zero exit stops the run with the three things
# needed to reproduce it: the command, the code, and what it said on stderr.
step() { # <what it is> <argument>...
    STEP=$1
    shift
    # The command as it would be typed again: an argument with a space in it
    # keeps its quotes, so a failing step can be copied out of the log and run.
    LAST_COMMAND=$CLI
    for argument in "$@"; do
        case $argument in
            *" "*) LAST_COMMAND="$LAST_COMMAND '$argument'" ;;
            *) LAST_COMMAND="$LAST_COMMAND $argument" ;;
        esac
    done
    # $CLI is split into words on purpose: it is the command being tested.
    # shellcheck disable=SC2086
    $CLI "$@" >"$STDOUT" 2>"$STDERR"
    status=$?
    if [ "$status" -ne 0 ]; then
        printf '\nsmoke: %s failed\n' "$STEP" >&2
        printf '  command    %s\n' "$LAST_COMMAND" >&2
        printf '  exit code  %s\n' "$status" >&2
        printf '  stderr:\n' >&2
        quote "$STDERR"
        exit 1
    fi
    printf '  %s\n' "$STEP"
}

# An expectation about the output of the step that just ran. The stdout it
# failed on is printed with it: without it the message names a mismatch and
# leaves the reader to run the command again by hand.
expect_stdout() { # <pattern> <what was expected>
    grep -q "$1" "$STDOUT" && return 0
    printf '\nsmoke: %s, after %s\n' "$2" "$STEP" >&2
    printf '  command    %s\n' "$LAST_COMMAND" >&2
    printf '  expected   %s\n' "$1" >&2
    printf '  stdout:\n' >&2
    quote "$STDOUT"
    exit 1
}

expect_equal() { # <actual> <expected> <what it is>
    [ "$1" = "$2" ] && return 0
    printf '\nsmoke: %s\n' "$3" >&2
    printf '  command    %s\n' "$LAST_COMMAND" >&2
    printf '  expected   %s\n' "$2" >&2
    printf '  got        %s\n' "$1" >&2
    exit 1
}

# What `serve` said when it did not serve. `serve` is the one command that is
# not run through `step()`, so it prints the same things itself — and both of
# its streams, because this is where the answer often sits on stdout: an
# address printed in a form the readiness check did not recognise, or a message
# that never reached stderr at all.
serve_failed() { # <port> <what happened> <exit code|->
    printf '\nsmoke: %s\n' "$2" >&2
    printf '  command    %s serve --root %s --port %s\n' "$CLI" "$ROOT" "$1" >&2
    printf '  exit code  %s\n' "$3" >&2
    printf '  stdout:\n' >&2
    quote "$SERVE_OUT"
    printf '  stderr:\n' >&2
    quote "$SERVE_ERR"
    exit 1
}

# `serve` in the background on a port nothing else holds. Returns 0 when it is
# listening and 1 when the port was taken; anything else ends the run here.
#
# The port is the only death worth another try, and it has to be read out of
# what `serve` said, because every other death looks the same from outside: a
# Bun-only API that crashes the server on Node — the failure this matrix exists
# to catch — would otherwise be reported as ten busy ports and a port number
# nothing was ever wrong with. Node and Bun word it differently, so both
# wordings are matched. A server that starts and then never answers is not a
# port problem either.
start_server() { # <port>
    # shellcheck disable=SC2086
    $CLI serve --root "$ROOT" --port "$1" >"$SERVE_OUT" 2>"$SERVE_ERR" &
    SERVER_PID=$!
    tries=0
    while [ "$tries" -lt 30 ]; do
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then
            wait "$SERVER_PID"
            code=$?
            SERVER_PID=
            # Node: `listen EADDRINUSE: address already in use 127.0.0.1:4880`.
            # Bun: `Failed to start server. Is port 4880 in use?`.
            if grep -Eq 'EADDRINUSE|address already in use|Is port [0-9]+ in use' "$SERVE_ERR"; then
                return 1
            fi
            serve_failed "$1" "serve exited instead of serving the review" "$code"
        fi
        # The address line is what proves the answer comes from this server and
        # not from whatever else holds the port: something already listening
        # there answers `/api/review` with its own review, and a scenario that
        # accepted it would test a stranger's server.
        if grep -q "on http://127.0.0.1:$1" "$SERVE_OUT" &&
            curl -fsS -o "$WORK/review.json" "http://127.0.0.1:$1/api/review" 2>/dev/null; then
            return 0
        fi
        sleep 1
        tries=$((tries + 1))
    done
    serve_failed "$1" "serve did not answer within 30 seconds" "still running"
}

printf 'smoke: %s\n' "$CLI"
printf '  root %s, JSON read with %s\n' "$ROOT" "$JSON"

# The fixture: the small profile of the synthetic review, three repositories
# with changes under a root of its own.
if ! bun run synth -- --out "$ROOT" --small >"$WORK/synth.out" 2>"$WORK/synth.err"; then
    printf '\nsmoke: the synthetic review could not be generated\n' >&2
    printf '  command    bun run synth -- --out %s --small\n' "$ROOT" >&2
    printf '  stderr:\n' >&2
    quote "$WORK/synth.err"
    exit 1
fi
printf '  synthetic review generated\n'

step "review new" review new smoke --title "smoke scenario" --root "$ROOT"
expect_stdout "created review session smoke (base head)" "the session was not created"

# The change set, and the anchor of the comment with it: a line the fixture
# really changed, read out of the same JSON an agent would read.
step "diff --json" diff --json --root "$ROOT"
cp "$STDOUT" "$WORK/diff.json"
read_json anchor "$WORK/diff.json"
anchor=$QUERY_OUT
REPO=$(printf '%s' "$anchor" | cut -f1)
PATH_IN_REPO=$(printf '%s' "$anchor" | cut -f2)
LINE=$(printf '%s' "$anchor" | cut -f3)
[ -n "$REPO" ] && [ -n "$PATH_IN_REPO" ] && [ -n "$LINE" ] ||
    fail "the change set named no line to comment on"
printf '  anchor %s/%s:%s\n' "$REPO" "$PATH_IN_REPO" "$LINE"
read_json totals "$WORK/diff.json"
cli_totals=$QUERY_OUT

# The server: the page and the review, on a port of its own.
port=$((20000 + $$ % 20000))
first_port=$port
attempt=0
# Only a taken port comes back here; every other outcome ended the run inside.
while ! start_server "$port"; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 10 ] || fail "ports $first_port to $port are all in use"
    port=$((port + 1))
done
printf '  serve on 127.0.0.1:%s\n' "$port"

LAST_COMMAND="$CLI serve --root $ROOT --port $port"
STEP="serve"
# The server scans the root itself; it must find the review the CLI found.
read_json totals "$WORK/review.json"
server_totals=$QUERY_OUT
expect_equal "$server_totals" "$cli_totals" "/api/review and diff --json disagree about the review"
curl -fsS -o "$WORK/index.html" "http://127.0.0.1:$port/" ||
    fail "the page was not served on 127.0.0.1:$port"
grep -q 'id="root"' "$WORK/index.html" ||
    fail "127.0.0.1:$port/ served something that is not the review page"
printf '  the review and the page are served\n'

# The human opens a finding, the agent answers it, the human closes it: the
# roles of `docs/SPEC.md` section 3, decision 8, in the order they happen.
BODY="the smoke scenario left this comment"
step "comment" comment --repo "$REPO" --path "$PATH_IN_REPO" --line "$LINE" \
    --severity warning --body "$BODY" --author smoke-human --role human --root "$ROOT"
expect_stdout "^c_.* opened on $REPO/" "the comment was not opened where it was asked for"
ID=$(cut -d' ' -f1 "$STDOUT")

step "list --json" list --json --root "$ROOT"
cp "$STDOUT" "$WORK/list.json"
read_json comments "$WORK/list.json"
expect_equal "$QUERY_OUT" \
    "$(printf '%s\topen\twarning\t%s\t%s\t%s\tsmoke-human\t0' "$ID" "$REPO" "$PATH_IN_REPO" "$LINE")" \
    "list --json does not show the comment that was just opened"

# Before the reply the thread is unanswered, after it is not: an empty answer
# to a question nothing was ever asked would pass without the first check.
step "list --unanswered --json" list --unanswered --json --root "$ROOT"
cp "$STDOUT" "$WORK/unanswered.json"
read_json comments "$WORK/unanswered.json"
expect_equal "$QUERY_ROWS" "1" \
    "the human's thread is not in list --unanswered"

step "reply" reply "$ID" --body "the smoke scenario answered it" --root "$ROOT"
expect_stdout "^r_.* added to $ID$" "the reply was not added to the thread"

step "list --unanswered --json (answered)" list --unanswered --json --root "$ROOT"
cp "$STDOUT" "$WORK/unanswered.json"
read_json comments "$WORK/unanswered.json"
expect_equal "$QUERY_ROWS" "0" \
    "the thread is still unanswered after the agent replied"

step "resolve --role human" resolve "$ID" --role human --author smoke-human \
    --note "the smoke scenario closed it" --root "$ROOT"
expect_stdout "^$ID resolved by smoke-human$" "the thread was not resolved"

step "list --json (open)" list --json --root "$ROOT"
cp "$STDOUT" "$WORK/list.json"
read_json comments "$WORK/list.json"
expect_equal "$QUERY_ROWS" "0" \
    "the resolved thread is still open"

step "list --status resolved --json" list --status resolved --json --root "$ROOT"
cp "$STDOUT" "$WORK/list.json"
read_json comments "$WORK/list.json"
expect_equal "$QUERY_OUT" \
    "$(printf '%s\tresolved\twarning\t%s\t%s\t%s\tsmoke-human\t2' "$ID" "$REPO" "$PATH_IN_REPO" "$LINE")" \
    "the resolved thread does not carry the reply and the note"

step "export --status all" export --status all --root "$ROOT"
expect_stdout "$BODY" "the export does not carry the comment"
expect_stdout "$REPO" "the export does not group the comment under its repository"

step "export --status all --format json" export --status all --format json --root "$ROOT"
cp "$STDOUT" "$WORK/export.json"
read_json comments "$WORK/export.json"
expect_equal "$QUERY_ROWS" "1" \
    "the JSON export does not carry the comment"

# The server goes down with the scenario, and the port with it.
kill "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
SERVER_PID=
if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/review" 2>/dev/null; then
    fail "something is still answering on 127.0.0.1:$port after serve was stopped"
fi
printf '  serve stopped\n'

printf 'smoke: %s passed\n' "$CLI"
