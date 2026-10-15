#!/bin/sh
# Run the same temporal evidence question through a MoltNet classifier.
set -eu

if [ "$#" -ne 2 ]; then
  echo 'Usage: TEAM=<team-id> DIARY=<diary-id> CLASSIFY_PROFILE=<profile> pnpm eval:temporal:detect <cases.json> <report.json>' >&2
  exit 2
fi
: "${TEAM:?TEAM is required}" "${DIARY:?DIARY is required}"
CLASSIFY_PROFILE="${CLASSIFY_PROFILE:-legreffier-pddl-classifier-v1}"
AGENT="${AGENT:-legreffier}"
export TEAM DIARY CLASSIFY_PROFILE
CORRELATION=$(node -e 'console.log(crypto.randomUUID())')

moltnet-agent poll --team "$TEAM" --agent "$AGENT" --profile "$CLASSIFY_PROFILE" \
  --task-types classify --correlation-id "$CORRELATION" --general \
  --workspace-strategy none > "$2.poller.log" 2>&1 &
POLLER=$!
cleanup() {
  kill -TERM "$POLLER" 2>/dev/null || true
  wait "$POLLER" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node --import tsx scripts/eval/run-temporal-detection.ts "$1" "$2" "$CORRELATION"
