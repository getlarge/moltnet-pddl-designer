#!/bin/sh
# Run the same temporal evidence question through a MoltNet classifier.
set -eu

if [ "$#" -ne 2 ]; then
  echo 'Usage: TEAM=<team-id> DIARY=<diary-id> CLASSIFY_PROFILE=<profile> pnpm eval:temporal:detect <cases.json> <report.json>' >&2
  exit 2
fi
node --import tsx scripts/eval/check-distinct-paths.ts "$1" "$2" "$2.poller.log"
CORRELATION=$(node -e 'console.log(crypto.randomUUID())')
REPORT_FILE=$2
printf '{"runId":"%s","status":"started","completed":0,"predictions":[]}\n' "$CORRELATION" > "$2"
if [ -z "${TEAM:-}" ] || [ -z "${DIARY:-}" ]; then
  printf '{"runId":"%s","status":"failed","completed":0,"predictions":[],"error":"TEAM and DIARY are required"}\n' "$CORRELATION" > "$2"
  echo 'TEAM and DIARY are required' >&2
  exit 2
fi
CLASSIFY_PROFILE="${CLASSIFY_PROFILE:-legreffier-pddl-classifier-v1}"
AGENT="${AGENT:-legreffier}"
export TEAM DIARY CLASSIFY_PROFILE

moltnet-agent poll --team "$TEAM" --agent "$AGENT" --profile "$CLASSIFY_PROFILE" \
  --task-types classify --correlation-id "$CORRELATION" --general \
  --workspace-strategy none > "$2.poller.log" 2>&1 &
POLLER=$!
RUNNER=''
SIGNAL=''
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ -n "$RUNNER" ]; then
    kill -TERM "$RUNNER" 2>/dev/null || true
    wait "$RUNNER" 2>/dev/null || true
  fi
  kill -TERM "$POLLER" 2>/dev/null || true
  wait "$POLLER" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    node -e '
      const fs = require("node:fs");
      const [reportPath, signal] = process.argv.slice(1);
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
      fs.writeFileSync(reportPath, JSON.stringify({
        ...report,
        status: "failed",
        error: signal ? `Interrupted by ${signal}.` : report.error ?? "Detection run failed."
      }, null, 2) + "\n");
    ' "$REPORT_FILE" "${SIGNAL:-}" || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'SIGNAL=SIGINT; exit 130' INT
trap 'SIGNAL=SIGTERM; exit 143' TERM

node --import tsx scripts/eval/run-temporal-detection.ts "$1" "$2" "$CORRELATION" &
RUNNER=$!
wait "$RUNNER"
RUNNER=''
