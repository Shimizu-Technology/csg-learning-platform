#!/usr/bin/env bash
# Final W8.4 gate on the exclusive, secret-free ASUS runner.
# Keep student-workspace-gate.sh's MigrationDatabaseProcessTest port adapter
# and both API prepared-statement modes intact.
set -uo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"
failures=0
run() {
  local label="$1"; shift
  "$@"
  local result=$?
  printf '\nRESULT %s: %s\n' "$label" "$result"
  if [ "$result" -ne 0 ]; then failures=$((failures + 1)); fi
}
run cross-stack bash scripts/qa/student-workspace-gate.sh
run web-routing npm --prefix web run test:netlify
run mobile-brand mise exec node@22.22.3 -- npm --prefix mobile run brand:check
run mobile-uri mise exec node@22.22.3 -- npm --prefix mobile run test:uri-decoder
run mobile-release mise exec node@22.22.3 -- npm --prefix mobile run test:ota-release
printf '\nFIRST RUN GATE failed stages: %s\n' "$failures"
exit "$failures"
