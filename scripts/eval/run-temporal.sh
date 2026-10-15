#!/bin/sh
# Start a scoped MoltNet worker, collect actual predictions, and score them.
set -eu

if [ "$#" -ne 3 ]; then
  echo 'Usage: TEAM=<team-id> DIARY=<diary-id> [PROFILE=<generation-profile>] pnpm eval:temporal:live <cases.json> <predictions.jsonl> <report.json>' >&2
  exit 2
fi
CORRELATION=$(node -e 'console.log(crypto.randomUUID())')
REPORT_FILE=$3
META_FILE="$2.meta.json"
# Clear all outputs even when local configuration fails before the runner starts.
: > "$2"
printf '{"runId":"%s","status":"started","timings":[]}\n' "$CORRELATION" > "$2.meta.json"
printf '{"runId":"%s","status":"started","completed":0}\n' "$CORRELATION" > "$3"
POLLER=''
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ]; then
    node -e '
      const fs = require("node:fs");
      const [reportPath, metadataPath] = process.argv.slice(1);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      let report;
      try { report = JSON.parse(fs.readFileSync(reportPath, "utf8")); }
      catch { report = { runId: metadata.runId }; }
      fs.writeFileSync(reportPath, JSON.stringify({
        ...report,
        status: "failed",
        completed: metadata.timings?.length ?? report.completed ?? 0,
        failedCaseId: metadata.failedCaseId,
        failedTaskId: metadata.failedTaskId,
        error: metadata.error ?? "Live temporal evaluation failed before scoring."
      }, null, 2) + "\n");
    ' "$REPORT_FILE" "$META_FILE" || true
  fi
  if [ -n "$POLLER" ]; then
    kill -TERM "$POLLER" 2>/dev/null || true
    wait "$POLLER" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
if [ -z "${TEAM:-}" ] || [ -z "${DIARY:-}" ]; then
  echo 'TEAM and DIARY are required' >&2
  exit 2
fi
PROFILE="${PROFILE:-legreffier-pddl-designer-v1}"
AGENT="${AGENT:-legreffier}"
export TEAM DIARY PROFILE

moltnet-agent poll --team "$TEAM" --agent "$AGENT" --profile "$PROFILE" \
  --task-types freeform --correlation-id "$CORRELATION" --general \
  --workspace-strategy none > "$2.poller.log" 2>&1 &
POLLER=$!
trap 'exit 130' INT
trap 'exit 143' TERM

node --import tsx scripts/eval/run-temporal.ts "$1" "$2" "$CORRELATION"
pnpm --silent eval:temporal "$1" "$2" "$3"
