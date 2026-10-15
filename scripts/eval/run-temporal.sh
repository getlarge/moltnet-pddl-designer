#!/bin/sh
# Start a scoped MoltNet worker, collect actual predictions, and score them.
set -eu

if [ "$#" -ne 3 ]; then
  echo 'Usage: TEAM=<team-id> DIARY=<diary-id> [PROFILE=<generation-profile>] pnpm eval:temporal:live <cases.json> <predictions.jsonl> <report.json>' >&2
  exit 2
fi
: "${TEAM:?TEAM is required}" "${DIARY:?DIARY is required}"
PROFILE="${PROFILE:-legreffier-pddl-designer-v1}"
AGENT="${AGENT:-legreffier}"
export TEAM DIARY PROFILE
CORRELATION=$(node -e 'console.log(crypto.randomUUID())')

moltnet-agent poll --team "$TEAM" --agent "$AGENT" --profile "$PROFILE" \
  --task-types freeform --correlation-id "$CORRELATION" --general \
  --workspace-strategy none > "$2.poller.log" 2>&1 &
POLLER=$!
cleanup() {
  kill -TERM "$POLLER" 2>/dev/null || true
  wait "$POLLER" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node --import tsx scripts/eval/run-temporal.ts "$1" "$2" "$CORRELATION"
pnpm --silent eval:temporal "$1" "$2" "$3"
