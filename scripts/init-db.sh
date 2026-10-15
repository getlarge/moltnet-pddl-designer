#!/usr/bin/env bash
set -euo pipefail
: "${PDDL_DATABASE_URL:?Set PDDL_DATABASE_URL to a dedicated designer database}"
export ABSURD_DATABASE_URL="$PDDL_DATABASE_URL"
version="$(uvx --from absurdctl==0.4.0 absurdctl schema-version)"
case "$version" in
  unknown) uvx --from absurdctl==0.4.0 absurdctl init --ref 0.4.0 ;;
  0.4.0) ;;
  *) echo "Expected Absurd 0.4.0; found $version. Migrate this database explicitly before continuing." >&2; exit 1 ;;
esac
pnpm exec tsx packages/persistence/scripts/migrate.ts
