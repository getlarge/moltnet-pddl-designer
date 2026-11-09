#!/bin/sh
# Run once per output directory; preserve the unedited baseline.
set -eu
cd "$(dirname "$0")/../.."
: "${MOLTNET_AGENT_BUNDLE_ROOT:?Set the path to a verified signed Agent bundle}"
out=${1:?Usage: sh examples/housing-historical/run.sh OUTPUT_DIRECTORY}
case "$out" in /*) ;; *) echo "Output must be absolute" >&2; exit 1;; esac
[ ! -e "$out" ] || { echo "Output already exists; choose a new directory" >&2; exit 1; }
codesign --verify --deep --strict "$MOLTNET_AGENT_BUNDLE_ROOT/libexec/moltnet-agent"
mkdir -p "$out"
correlation=$(node -e 'console.log(require("./examples/housing-historical/manifest.json").correlationId)')
root=$(pwd)
worker=''
cleanup() { if [ -n "$worker" ]; then kill -TERM "$worker" 2>/dev/null || true; wait "$worker" || true; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$MOLTNET_AGENT_BUNDLE_ROOT/libexec/moltnet-agent" "$MOLTNET_AGENT_BUNDLE_ROOT/daemon/dist/main.js" poll --team 6743b4b1-6b93-46e2-a048-19490f04f91a --agent legreffier --profile cbd3a039-0f3e-438c-af6f-82bd91837a9f --task-types freeform --correlation-id "$correlation" --diary-ids 8a4d7ecd-b7ec-49d1-8e50-0da328159ed0 --general --workspace-strategy none --state-dir "$out/worker-state" > "$out/worker.log" 2>&1 &
worker=$!
status=0
moltnet start node -- --import "$root/node_modules/tsx/dist/loader.mjs" "$root/apps/cli/src/cli.ts" --description "$root/examples/housing-historical/description.md" --problem "$root/examples/housing-historical/situation.md" --domain-name housing-historical --problem-name house-1 --team 6743b4b1-6b93-46e2-a048-19490f04f91a --diary 8a4d7ecd-b7ec-49d1-8e50-0da328159ed0 --generation-profile cbd3a039-0f3e-438c-af6f-82bd91837a9f --correlation "$correlation" --max-corrections 1 --claim-timeout 120 --out "$out/run.json" > "$out/stdout.log" 2> "$out/progress.log" || status=$?
printf '%s\n' "$status" > "$out/exit-code.txt"
exit "$status"
