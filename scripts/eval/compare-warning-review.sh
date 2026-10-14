#!/bin/sh
# Three interleaved lanes using the same model profiles and frozen examples.
# Expected outcomes are in required.json; only description/situation enter tasks.
set -eu
: "${TEAM:?TEAM is required}" "${DIARY:?DIARY is required}"
: "${RUNS_DIR:?RUNS_DIR is required}" "${PREFIX:?PREFIX is required}"
: "${CLASSIFY_PROFILE:?CLASSIFY_PROFILE is required}"
RUNS="${RUNS:-3}"
case "$RUNS" in ''|*[!0-9]*) echo 'RUNS must be a non-negative integer' >&2; exit 1 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$(cd "$HERE/../.." && pwd)"
EXAMPLES_DIR="${EXAMPLES_DIR:-$LIB/examples}"
export EXAMPLES_DIR
mkdir -p "$RUNS_DIR"
if [ -e "$RUNS_DIR/$PREFIX-profiles.json" ]; then
  echo "Experiment prefix already exists: $PREFIX; choose a fresh prefix" >&2
  exit 1
fi
# Freeze the profile definitions and scorer revision before any task runs.
moltnet profile list --team-id "$TEAM" > "$RUNS_DIR/$PREFIX-profiles.json"
git -C "$LIB" rev-parse HEAD > "$RUNS_DIR/$PREFIX-base-revision.txt"
git -C "$LIB" diff --binary HEAD > "$RUNS_DIR/$PREFIX-implementation.patch"
for example in warning-owned-work warning-shared-work warning-inspection warning-certification; do
  cp "$EXAMPLES_DIR/$example/required.json" "$RUNS_DIR/$PREFIX-$example-required.json"
  mkdir -p "$RUNS_DIR/$PREFIX-inputs/$example"
  cp "$EXAMPLES_DIR/$example/description.md" "$EXAMPLES_DIR/$example/situation.md" "$RUNS_DIR/$PREFIX-inputs/$example/"
done
EXAMPLES_DIR="$RUNS_DIR/$PREFIX-inputs"
export EXAMPLES_DIR
tar -czf "$RUNS_DIR/$PREFIX-source.tar.gz" -C "$LIB" src scripts examples runtime package.json pnpm-lock.yaml tsconfig.json pnpm-workspace.yaml
n=1
while [ "$n" -le "$RUNS" ]; do
  for example in warning-owned-work warning-shared-work warning-inspection warning-certification; do
    for lane in baseline final early; do
      case "$lane" in
        baseline) flags='' ;;
        final) flags='--review' ;;
        early) flags='--warning-review' ;;
      esac
      # A failed model/task run is evidence; it must not stop the other lanes.
      EXTRA="$flags ${EXTRA:-}" sh "$HERE/run-example.sh" "$example" "$PREFIX-$lane-$example-$n" || :
    done
  done
  n=$((n + 1))
done
cd "$LIB"
pnpm exec tsx scripts/eval/report-warning-review.ts "$RUNS_DIR" "$PREFIX"
