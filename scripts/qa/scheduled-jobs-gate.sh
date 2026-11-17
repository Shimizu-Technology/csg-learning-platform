#!/usr/bin/env bash
# Secret-free ASUS API gate. Keep the migration subprocess loopback port adapter.
set -uo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"
export RAILS_ENV=test DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/csg_learning_platform_test
export MIGRATION_PROCESS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
export PARALLEL_WORKERS=1 OPENAPI_COVERAGE=1 CI=true PGGSSENCMODE=disable
cd api || exit 1
bundle install --quiet || exit 1
bundle exec rails db:schema:load || exit 1
failures=0
run() {
  local label="$1"; shift
  "$@"
  local result=$?
  printf '\nRESULT %s: %s\n' "$label" "$result"
  if [ "$result" -ne 0 ]; then failures=$((failures + 1)); fi
}
run prepared-mode bundle exec rails runner 'abort "Prepared statements unexpectedly disabled" unless ActiveRecord::Base.connection.prepared_statements'
run api bundle exec rails test
run unprepared-mode env DATABASE_URL="${DATABASE_URL}?prepared_statements=false" bundle exec rails runner 'abort "Prepared statements unexpectedly enabled" if ActiveRecord::Base.connection.prepared_statements'
run api-unprepared env DATABASE_URL="${DATABASE_URL}?prepared_statements=false" bundle exec rails test
run rubocop bundle exec rubocop
run brakeman bundle exec brakeman --no-pager
printf '\nGATE failed stages: %s\n' "$failures"
exit "$failures"
