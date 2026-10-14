#!/bin/sh
# Run the PDDL designer once on one example, with a poller scoped to a fresh
# correlation id that is stopped when the run ends.
#
#   TEAM=<team-id> DIARY=<diary-id> RUNS_DIR=<dir> \
#     [PROFILE=<profile>] [CLASSIFY_PROFILE=<profile>] [AGENT=<agent>] \
#     [EXAMPLES_DIR=<dir>] [EXTRA="<cli flags>"] \
#     sh scripts/eval/run-example.sh <example> <label>
#
# Writes <RUNS_DIR>/run-<label>.json, daemon-<label>.log and cli-<label>.err.
set -u
EXAMPLE="$1"
LABEL="$2"
: "${TEAM:?TEAM is required}" "${DIARY:?DIARY is required}" "${RUNS_DIR:?RUNS_DIR is required}"
LIB="$(cd "$(dirname "$0")/../.." && pwd)"
EXAMPLES_DIR="${EXAMPLES_DIR:-$LIB/examples}"
PROFILE="${PROFILE:-legreffier-pddl-designer-v1}"
AGENT="${AGENT:-legreffier}"
CORR=$(node -e 'console.log(crypto.randomUUID())')
mkdir -p "$RUNS_DIR"
POLLER=''
CLASSIFIER_POLLER=''
cleanup() {
  for worker in "$POLLER" "$CLASSIFIER_POLLER"; do
    if [ -n "$worker" ]; then kill -TERM "$worker" 2>/dev/null || :; fi
  done
  for worker in "$POLLER" "$CLASSIFIER_POLLER"; do
    if [ -n "$worker" ]; then wait "$worker" 2>/dev/null || :; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

moltnet-agent poll --team "$TEAM" --agent "$AGENT" --profile "$PROFILE" \
  --task-types freeform --correlation-id "$CORR" --diary-ids "$DIARY" --general \
  --workspace-strategy none > "$RUNS_DIR/daemon-$LABEL.log" 2>&1 &
POLLER=$!
if [ -n "${CLASSIFY_PROFILE:-}" ]; then
  moltnet-agent poll --team "$TEAM" --agent "$AGENT" --profile "$CLASSIFY_PROFILE" \
    --task-types classify --correlation-id "$CORR" --diary-ids "$DIARY" --general \
    --workspace-strategy none > "$RUNS_DIR/classifier-$LABEL.log" 2>&1 &
  CLASSIFIER_POLLER=$!
fi

cd "$LIB" || exit 1
set -- \
  --description "$EXAMPLES_DIR/$EXAMPLE/description.md" \
  --problem "$EXAMPLES_DIR/$EXAMPLE/situation.md" \
  --domain-name "$EXAMPLE" --problem-name "$LABEL" \
  --team "$TEAM" --diary "$DIARY" --profile "$PROFILE" \
  --correlation "$CORR" --out "$RUNS_DIR/run-$LABEL.json"
if [ -n "${CLASSIFY_PROFILE:-}" ]; then
  set -- "$@" --classify-profile "$CLASSIFY_PROFILE"
fi
# EXTRA is intentionally a whitespace-separated list of CLI arguments.
# shellcheck disable=SC2086
pnpm --silent cli "$@" ${EXTRA:-} \
  2> "$RUNS_DIR/cli-$LABEL.err"
CODE=$?

echo "$LABEL exit=$CODE correlation=$CORR"
tail -1 "$RUNS_DIR/cli-$LABEL.err"
exit "$CODE"
