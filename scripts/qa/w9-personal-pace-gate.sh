#!/usr/bin/env bash
# W9.1 personal pace gate. Run from the repository root on the secret-free ASUS runner:
#   asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/w9-personal-pace-gate.sh
set -u
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"
export RAILS_ENV=test DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/csg_learning_platform_test
export MIGRATION_PROCESS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
export PARALLEL_WORKERS=1 OPENAPI_COVERAGE=1 CI=true PGGSSENCMODE=disable
failures=0
run() {
  printf '\nChecking %s\n' "$1"
  label="$1"; shift
  "$@"
  result=$?
  printf '\nRESULT %s: %s\n' "$label" "$result"
  if [ "$result" -ne 0 ]; then failures=$((failures + 1)); fi
}
run qa-ownership node --test scripts/qa/ownership.test.mjs
# asus-test intentionally excludes .git. Vite indexes the tracked school-brand
# assets, so give this disposable source snapshot a local index (no remote/login).
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git init -q; fi
run brand-index git add -- web/brand-public
cd api || exit 1
run bundle bundle install --quiet
run schema bundle exec rails db:schema:load
run api bundle exec rails test
run api-unprepared env DATABASE_URL="${DATABASE_URL}?prepared_statements=false" bundle exec rails test
run rubocop bundle exec rubocop
run brakeman bundle exec brakeman --no-pager
cd ../web || exit 1
run web-install npm ci --no-audit --no-fund
run web-typecheck npm run typecheck
run web-lint npm run lint
run web-vitest npm test -- --maxWorkers=2
run web-build npm run build
run web-bundle npm run test:bundle
run api-check npm run api:check
cd ../mobile || exit 1
run mobile-install mise exec node@22.22.3 -- npm ci --no-audit --no-fund
run mobile-typecheck mise exec node@22.22.3 -- npm run typecheck
run mobile-lint mise exec node@22.22.3 -- npm run lint
run mobile-jest mise exec node@22.22.3 -- npm test
printf '\nGATE failed stages: %s\n' "$failures"
exit "$failures"
