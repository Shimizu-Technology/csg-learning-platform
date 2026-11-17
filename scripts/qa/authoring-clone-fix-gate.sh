#!/usr/bin/env bash
# Fix-round acceptance: one full production-mode API pass on ASUS.
# Preserve the migration subprocess port adapter and coverage inventory.
set -euo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"
export RAILS_ENV=test DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/csg_learning_platform_test?prepared_statements=false'
export MIGRATION_PROCESS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres
export PARALLEL_WORKERS=1 OPENAPI_COVERAGE=1 CI=true PGGSSENCMODE=disable
cd api
bundle install --quiet
bundle exec rails db:schema:load
bundle exec rails runner 'abort "Expected production prepared-statements mode" if ActiveRecord::Base.connection.prepared_statements'
bundle exec rails test
bundle exec rubocop
bundle exec brakeman --no-pager
