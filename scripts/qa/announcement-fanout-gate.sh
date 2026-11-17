#!/usr/bin/env bash
# Disposable ASUS gate; asus-test owns the Postgres container and WSL lifetime.
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$PWD
export RAILS_ENV=test PARALLEL_WORKERS=1
export POOLER_DIRECT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/csg_learning_platform_test
export DATABASE_URL=$POOLER_DIRECT_DATABASE_URL
export MIGRATION_PROCESS_TEST_DATABASE_URL=$POOLER_DIRECT_DATABASE_URL
cd api
bin/rails db:schema:load
bin/rubocop
bin/brakeman --no-pager
bin/bundler-audit
# Build a version supporting protocol prepared statements without changing
# shared packages or another builder's binary/configuration.
scratch=$(mktemp -d /tmp/csg-fanout-gate.XXXXXX)
cleanup() {
  if [[ -f "$scratch/pooler.pid" ]]; then
    kill "$(cat "$scratch/pooler.pid")" 2>/dev/null || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
curl -fsSL https://github.com/libevent/libevent/releases/download/release-2.1.12-stable/libevent-2.1.12-stable.tar.gz | tar -xz -C "$scratch"
(cd "$scratch/libevent-2.1.12-stable" && ./configure --prefix="$scratch/install" --disable-shared --disable-openssl > "$scratch/event-build.log" 2>&1 && make -j2 >> "$scratch/event-build.log" 2>&1 && make install >> "$scratch/event-build.log" 2>&1) || { cat "$scratch/event-build.log"; exit 1; }
export PKG_CONFIG_PATH="$scratch/install/lib/pkgconfig"
curl -fsSL https://www.pgbouncer.org/downloads/files/1.24.1/pgbouncer-1.24.1.tar.gz | tar -xz -C "$scratch"
(cd "$scratch/pgbouncer-1.24.1" && ./configure --prefix="$scratch/install" --without-cares --without-systemd --without-openssl > "$scratch/build.log" 2>&1 && make -j2 >> "$scratch/build.log" 2>&1 && make install >> "$scratch/build.log" 2>&1) || { cat "$scratch/build.log"; exit 1; }
run_suite() {
  local label=$1
  shift
  echo "API suite: $label prepared_statements=$prepared"
  set +e
  FAN_OUT_TIMING=1 bin/rails test "$@" --seed "${TEST_SEED:-5041}" > "$scratch/test-$prepared.log" 2>&1
  suite_status=$?
  set -e
  tail -n 5 "$scratch/test-$prepared.log"
  # Migration output can exceed tool output limits: always repeat any failure
  # near the end, together with the query/time samples.
  if command -v rg >/dev/null; then
    rg -n -A 18 '^Failure:|^Error:|\[publish measurements\]' "$scratch/test-$prepared.log" || true
  else
    sed -n -e '/^Failure:/,+18p' -e '/^Error:/,+18p' -e '/\[publish measurements\]/p' "$scratch/test-$prepared.log"
  fi
  if [[ $suite_status != 0 ]]; then
    head -n 35 "$scratch/test-$prepared.log"
    exit "$suite_status"
  fi
}
for prepared in false true; do
  max_prepared=0
  [[ $prepared == false ]] || max_prepared=100
  sed -e 's/port=5432/port=55432/' \
    -e "s|auth_file = .*|auth_file = $root/.github/pgbouncer/userlist.txt|" \
    -e "s|logfile = .*|logfile = $scratch/pooler.log|" \
    -e "s|pidfile = .*|pidfile = $scratch/pooler.pid|" \
    "$root/.github/pgbouncer/pgbouncer.ini" > "$scratch/pooler.ini"
  echo "max_prepared_statements = $max_prepared" >> "$scratch/pooler.ini"
  "$scratch/install/bin/pgbouncer" -d "$scratch/pooler.ini"
  for attempt in {1..30}; do
    [[ ! -f "$scratch/pooler.pid" ]] || break
    sleep 0.1
  done
  export POOLER_CANARY=1 EXPECTED_PREPARED_STATEMENTS=$prepared EXPECTED_MAX_PREPARED=$max_prepared
  export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:16432/csg_learning_platform_test?prepared_statements=$prepared"
  bundle exec ruby ../.github/pgbouncer/verify.rb
  if [[ ${FANOUT_REVIEW_GATE:-0} == 1 ]]; then
    run_suite focused test/jobs/announcement_fanout_job_test.rb test/jobs/push_notification_job_test.rb \
      test/integration/announcement_fanout_races_test.rb test/integration/update_drafts_test.rb \
      test/integration/scheduled_updates_test.rb test/integration/scheduled_update_races_test.rb \
      test/integration/sends_after_commit_test.rb test/models/announcement_test.rb \
      test/services/scheduled_tick_test.rb test/migrations/add_fanout_outbox_to_announcements_test.rb \
      test/migrations/create_authoring_clones_test.rb test/migrations/refine_authoring_clone_receipts_test.rb
    [[ ${FANOUT_FOCUSED_ONLY:-0} == 1 || $prepared == true ]] || run_suite full
  else
    run_suite full
  fi
  if [[ ${SCHEDULED_PUSH_STRESS:-0} == 1 ]]; then
    SCHEDULED_PUSH_STRESS_RUNS=50 run_suite released-claim-stress test/integration/scheduled_update_races_test.rb --include '/released_claim_stress/'
  fi
  kill "$(cat "$scratch/pooler.pid")"
  for attempt in {1..50}; do
    [[ -f "$scratch/pooler.pid" ]] || break
    sleep 0.1
  done
  [[ ! -f "$scratch/pooler.pid" ]] || { echo 'pooler did not stop'; exit 1; }
done
